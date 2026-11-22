import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [{ name: 'editor', test: /[\\/]node_modules[\\/](@codemirror|@lezer|style-mod|crelt|@marijn)[\\/]/ }],
        },
      },
    },
  },
})
