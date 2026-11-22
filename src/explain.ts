import { mount, port } from './compare.ts'
import { mapping, readComposeYaml, type Location, type Mapping, type Value } from './yaml.ts'

type Path = (string | number)[]
type Locate = (path: Path) => Location | undefined
export type Detail = { label: string; text: string; location?: Location }
export type ServiceStep = { name: string; summary: string; location?: Location; dependencies: Detail[]; details: Detail[] }
export type Startup = { resources: Detail[]; levels: ServiceStep[][]; unordered: ServiceStep[]; notes: Detail[] }
type Dependency = { name: string; condition: Value; optional: boolean; path: Path }

const interpolated = /(^|[^$])(?:\$\$)*\$(?:\{|[a-z_])/i
const items = (value: Value | undefined) => Array.isArray(value) ? value : []
const string = (value: Value | undefined) => typeof value === 'string' ? value : ''
const names = (value: Value | undefined) => Array.isArray(value) ? value.filter(item => typeof item === 'string') :
  mapping(value) ? Object.keys(value) : []

function hasVariables(value: Value): boolean {
  if (typeof value === 'string') return interpolated.test(value)
  if (Array.isArray(value)) return value.some(hasVariables)
  return mapping(value) && Object.values(value).some(hasVariables)
}

function dependencies(service: Mapping, path: Path) {
  const found = new Map<string, Dependency>()
  const add = (name: string, path: Path, config?: Mapping) => {
    if (!name) return
    const previous = found.get(name)
    if (previous) previous.optional = false
    else found.set(name, { name, condition: config?.condition ?? 'service_started', optional: config?.required === false, path })
  }
  const explicit = service.depends_on
  if (Array.isArray(explicit)) {
    explicit.forEach((name, index) => add(string(name), [...path, 'depends_on', index]))
  } else if (mapping(explicit)) {
    for (const [name, config] of Object.entries(explicit)) {
      add(name, [...path, 'depends_on', name], mapping(config) ? config : undefined)
    }
  }
  items(service.links).forEach((value, index) => add(string(value).split(':')[0], [...path, 'links', index]))
  items(service.volumes_from).forEach((value, index) => {
    const reference = string(value)
    if (reference.startsWith('container:')) return
    add(reference.replace(/^service:/, '').split(':')[0], [...path, 'volumes_from', index])
  })
  for (const key of ['network_mode', 'ipc', 'pid']) {
    const reference = string(service[key])
    if (reference.startsWith('service:')) add(reference.slice('service:'.length), [...path, key])
  }
  return [...found.values()]
}

function serviceStep(name: string, service: Mapping, locate: Locate): ServiceStep {
  const path = ['services', name]
  const details: Detail[] = []
  const add = (label: string, text: string, key: string, index?: number) =>
    details.push({ label, text, location: locate(index === undefined ? [...path, key] : [...path, key, index]) })
  const image = string(service.image)
  const summary = service.build !== undefined
    ? `Has a build definition${image ? ` and names the image ${image}` : ''}. Whether Compose builds or pulls depends on pull policy and how you run it.`
    : image ? `Runs the image ${image}.`
    : service.extends !== undefined ? 'The image or build definition may come from the parent service.'
    : 'No image or build is set in this service.'

  const profiles = names(service.profiles)
  if (profiles.length) add('Profiles', `Starts when a matching profile is active (${profiles.join(', ')}) or when you target this service directly.`, 'profiles')
  const networks = names(service.networks)
  if (service.network_mode === 'host') add('Host network', 'Uses the host network namespace.', 'network_mode')
  else if (service.network_mode !== undefined) add('Network mode', `Uses network mode ${string(service.network_mode)}.`, 'network_mode')
  else if (networks.length) add('Networks', `Joins ${networks.join(', ')}.`, 'networks')
  else if (service.extends === undefined) add('Networks', 'Joins the default project network.', 'networks')

  items(service.ports).forEach((value, index) => {
    if (typeof value === 'string' && interpolated.test(value) ||
        mapping(value) && ['host_ip', 'published', 'target', 'protocol'].some(key => interpolated.test(string(value[key])))) {
      add('Port', 'Resolve variables to see the host binding.', 'ports', index)
      return
    }
    try {
      const binding = port(value, `${name}.ports`)
      const address = binding.host
      const where = address ? ` on ${address.includes(':') ? `[${address}]` : address}` : ' on the default host address'
      const published = binding.published ? `host port ${binding.published}` : 'a host port assigned by Docker'
      add('Port', `Publishes container port ${binding.key} using ${published}${where}.`, 'ports', index)
    } catch {
      add('Port', 'Could not read this port binding.', 'ports', index)
    }
  })

  items(service.volumes).forEach((value, index) => {
    try {
      const [target, volume] = mount(value, `${name}.volumes`)
      const from = volume.type === 'bind' ? `host path ${volume.source}` : volume.type === 'volume'
        ? volume.source ? `volume ${volume.source}` : 'an anonymous volume'
        : volume.type === 'tmpfs' ? 'an in-memory filesystem' : `a ${volume.type} mount`
      add('Mount', `Mounts ${from} at ${target}${volume.read_only === true ? ' as read-only' : ''}.`, 'volumes', index)
    } catch {
      add('Mount', 'Could not read this mount.', 'volumes', index)
    }
  })

  if (service.healthcheck !== undefined) {
    const check = service.healthcheck
    const disabled = mapping(check) && (check.disable === true || items(check.test)[0] === 'NONE')
    add('Healthcheck', disabled ? 'Disables the container healthcheck.' : 'Sets how Docker checks whether the container is healthy.', 'healthcheck')
  }
  if (service.restart !== undefined) add('Restart policy', `Sets the container restart policy to ${service.restart}.`, 'restart')
  if (service.command !== undefined && service.command !== null) add('Command', 'Overrides the image command.', 'command')
  if (service.entrypoint !== undefined && service.entrypoint !== null) add('Entrypoint', 'Overrides the image entrypoint.', 'entrypoint')
  for (const [key, label, description] of [
    ['environment', 'Environment', 'Sets environment variables in the container.'],
    ['env_file', 'Environment file', 'Loads environment variables from files on the host.'],
    ['configs', 'Configs', 'Grants this service access to Compose configs.'],
    ['secrets', 'Secrets', 'Grants this service access to Compose secrets.'],
    ['volumes_from', 'Shared mounts', 'Uses mounts from another service or container.'],
  ]) {
    if (service[key] !== undefined) add(label, description, key)
  }
  if (service.privileged === true) add('Privileged mode', 'Grants the container extra access to the host.', 'privileged')
  return { name, summary, details, dependencies: [], location: locate([...path, service.build !== undefined ? 'build' : 'image']) }
}

function order(steps: Map<string, ServiceStep>, requirements: Map<string, Set<string>>) {
  const dependents = new Map<string, string[]>()
  const waiting = new Map<string, number>()
  let ready: string[] = []
  for (const [name, required] of requirements) {
    if (!required.size) ready.push(name)
    waiting.set(name, required.size)
    for (const dependency of required) {
      const list = dependents.get(dependency)
      if (list) list.push(name)
      else dependents.set(dependency, [name])
    }
  }
  const levels: ServiceStep[][] = []
  while (ready.length) {
    const next: string[] = []
    levels.push(ready.sort().map(name => {
      waiting.delete(name)
      for (const dependent of dependents.get(name) ?? []) {
        const remaining = waiting.get(dependent)! - 1
        waiting.set(dependent, remaining)
        if (remaining === 0) next.push(dependent)
      }
      return steps.get(name)!
    }))
    ready = next
  }
  return { levels, unordered: [...waiting.keys()].map(name => steps.get(name)!) }
}

export function explainCompose(source: string): Startup {
  const { data, locate } = readComposeYaml(source)
  const notes: Detail[] = []
  const note = (text: string, path: Path) => notes.push({ label: 'Unresolved', text, location: locate(path) })
  if ('include' in data) note('This file includes other Compose files. Their services and settings are missing from this view.', ['include'])
  if (hasVariables(data)) {
    note('Variables are shown as written. Values from the shell or .env may change the result.', [])
  }
  const services: Value | undefined = data.services === undefined && 'include' in data ? {} : data.services
  if (!mapping(services)) throw Error('Expected a top-level services mapping.')
  if (Object.keys(services).length > 250) throw Error('Explain supports up to 250 services per file.')
  const steps = new Map<string, ServiceStep>()
  const requirements = new Map<string, Set<string>>()
  let defaultNetwork = false
  for (const [name, service] of Object.entries(services)) {
    const path = ['services', name]
    if (!mapping(service)) throw Error(`Expected a mapping for service ${name}.`)
    if (service.extends !== undefined) note(`${name} extends another service. Inherited settings are missing from this view.`, [...path, 'extends'])
    const networks = names(service.networks)
    defaultNetwork ||= service.network_mode === undefined &&
      (networks.includes('default') || !networks.length && service.extends === undefined)
    const step = serviceStep(name, service, locate)
    const deps = dependencies(service, path)
    const needed = new Set<string>()
    for (const { name: dependency, path: dependencyPath, condition, optional } of deps) {
      const location = locate(dependencyPath)
      if (!Object.hasOwn(services, dependency)) {
        if (!optional) needed.add(dependency)
        step.dependencies.push({ label: 'Missing dependency',
          text: `${dependency} is ${optional ? 'optional and ' : 'required but '}not defined in this file.`, location })
        continue
      }
      const event = condition === 'service_healthy' ? 'to pass its healthcheck'
        : condition === 'service_completed_successfully' ? 'to exit successfully'
        : condition === 'service_started' ? 'to start' : ''
      const text = event ? `${optional ? 'If available, waits' : 'Waits'} for ${dependency} ${event}.`
        : `The condition for ${dependency} could not be resolved.`
      needed.add(dependency)
      step.dependencies.push({ label: optional ? 'Optional dependency' : 'Dependency', text, location })
    }
    requirements.set(name, needed)
    steps.set(name, step)
  }

  const resources: Detail[] = []
  const networks = mapping(data.networks) ? data.networks : {}
  if (defaultNetwork && !Object.hasOwn(networks, 'default')) {
    resources.push({ label: 'Default network', text: 'Compose uses an implicit project network for services without their own network settings.' })
  }
  for (const [key, label, local, external] of [
    ['networks', 'Network', 'Connects services that join this network.', 'Must already exist on the Docker host.'],
    ['volumes', 'Volume', 'Keeps data outside the container filesystem.', 'Must already exist on the Docker host.'],
    ['configs', 'Config', 'Makes configuration available to services that request it.', 'Compose looks up an existing config.'],
    ['secrets', 'Secret', 'Makes a secret available to services that request it.', 'Compose looks up an existing secret.'],
  ]) {
    const entries = data[key]
    if (!mapping(entries)) continue
    for (const [name, config] of Object.entries(entries)) {
      resources.push({ label: `${label} ${name}`, text: mapping(config) && config.external === true ? external : local,
        location: locate([key, name]) })
    }
  }
  return { resources, ...order(steps, requirements), notes }
}
