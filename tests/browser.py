from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from shutil import copytree
from tempfile import TemporaryDirectory
from threading import Thread
import os
import re

from playwright.sync_api import expect, sync_playwright


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript"}

    def log_message(self, *_):
        pass


def check(url):
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        context = browser.new_context(
            color_scheme="dark", viewport={"width": 1280, "height": 960},
            permissions=["clipboard-read", "clipboard-write"],
        )
        page = context.new_page()
        errors, requests, failures = [], [], []
        page.on("pageerror", lambda error: errors.append(str(error)))
        context.on("request", lambda request: requests.append((request.method, request.url)))
        page.on("response", lambda response: failures.append(response.url) if response.status >= 400 else None)
        page.goto(url, wait_until="networkidle")
        warning = page.get_by_role("heading", name=re.compile("no longer limited to loopback"))
        expect(warning).to_be_visible()
        screenshot_dir = os.environ.get("COMPOSEDIFF_SCREENSHOTS")
        if screenshot_dir:
            target = Path(screenshot_dir)
            target.mkdir(parents=True, exist_ok=True)
            page.screenshot(path=target / "composediff.png", full_page=True)

        page.get_by_role("button", name="Warnings 1").click()
        expect(page.get_by_role("heading", name="Image reference changed")).to_have_count(0)
        page.get_by_role("button", name="Copy Markdown").click()
        expect(page.get_by_text("Markdown copied. Check for secrets before sharing.")).to_be_visible()
        assert "Image reference changed" in page.evaluate("navigator.clipboard.readText()")
        with page.expect_download() as downloaded:
            page.get_by_role("button", name="Download", exact=True).click()
        assert downloaded.value.suggested_filename == "composediff.md"
        assert "127.0.0.1" in downloaded.value.path().read_text(encoding="utf-8")

        page.get_by_role("button", name="Swap").click()
        expect(page.get_by_role("heading", name="Port 5432/tcp changed")).to_be_visible()
        expect(warning).to_have_count(0)
        page.get_by_role("button", name="How it works").click()
        expect(page.get_by_role("dialog")).to_be_visible()
        page.keyboard.press("Escape")
        expect(page.get_by_role("dialog")).to_have_count(0)
        page.get_by_role("button", name="Clear", exact=True).click()
        page.get_by_role("button", name="Cancel", exact=True).click()
        expect(page.get_by_role("heading", name="Port 5432/tcp changed")).to_be_visible()
        page.get_by_role("button", name="Clear", exact=True).click()
        page.get_by_role("button", name="Clear both").click()
        expect(page.get_by_text("Open or paste YAML in both editors to compare.")).to_be_visible()

        with page.expect_file_chooser() as chooser:
            page.get_by_role("button", name="Open before file").click()
        chooser.value.set_files({
            "name": "original.yml", "mimeType": "text/yaml",
            "buffer": b"services:\n  db:\n    image: postgres:16\n    environment: [TOKEN=before-secret]\n",
        })
        expect(page.get_by_text("original.yml", exact=True)).to_be_visible()
        before = page.get_by_role("textbox", name="Before", exact=True)
        after = page.get_by_role("textbox", name="After", exact=True)
        after.fill("services:\n  db: [")
        expect(after).to_have_attribute("aria-invalid", "true")
        jump = page.get_by_role("button", name="Go to line 2")
        jump.focus()
        jump.press("Enter")
        expect(after).to_be_focused()
        assert after.evaluate("el => getSelection().anchorNode.parentElement.closest('.cm-line') === el.lastElementChild")
        page.get_by_role("button", name="Source diff").click()
        expect(page.get_by_role("region", name="Source diff lines")).to_contain_text("db: [")
        after.fill("services:\n  db:\n    image: postgres:16\n    environment: [TOKEN=after-secret]\n")
        page.get_by_role("button", name="Changes", exact=True).click()
        expect(page.get_by_role("heading", name="Environment variables updated")).to_be_visible()
        expect(after).not_to_have_attribute("aria-invalid", "true")
        page.get_by_role("button", name="Copy Markdown").click()
        expect(page.get_by_text("Markdown copied. Check for secrets before sharing.")).to_be_visible()
        assert "TOKEN" not in page.evaluate("navigator.clipboard.readText()")

        before.fill("services: {local_edit: {}}")
        expect(page.get_by_role("heading", name="Service removed")).to_be_visible()
        page.get_by_role("region", name="Before", exact=True).dispatch_event("drop", {
            "dataTransfer": page.evaluate_handle("""() => {
                const transfer = new DataTransfer()
                transfer.items.add(new File(['services: {}\\n'], 'dropped.yaml', {type: 'text/yaml'}))
                return transfer
            }"""),
        })
        expect(page.get_by_text("dropped.yaml", exact=True)).to_be_visible()
        expect(before).to_contain_text("services: {}")
        before.press("ControlOrMeta+z")
        expect(before).to_have_text("services: {}")
        expect(page.get_by_role("heading", name="Service added")).to_be_visible()

        after.fill("services:\n" + "".join(f"  app{i}: {{image: alpine}}\n" for i in range(6)))
        search = page.get_by_role("searchbox", name="Search changes")
        search.fill("app4")
        expect(page.get_by_role("heading", name="service app4")).to_be_visible()
        expect(page.get_by_role("heading", name="service app0")).to_have_count(0)
        after.fill("services: {app0: {image: alpine}}")
        expect(search).to_have_value("app4")
        expect(page.get_by_text("No matching changes.")).to_be_visible()
        search.fill("")
        expect(page.get_by_role("heading", name="service app0")).to_be_visible()

        after.fill("services: {app0: {image: alpine, privileged: true}}")
        page.get_by_role("button", name="Warnings 1").click()
        after.fill("services: {app0: {image: alpine}}")
        expect(page.get_by_role("button", name="All changes 1")).to_have_attribute("aria-pressed", "true")
        expect(page.get_by_role("heading", name="Service added")).to_be_visible()

        explain = page.get_by_role("button", name="Explain", exact=True)
        explain.click()
        timeline = page.get_by_role("region", name="Startup timeline")
        expect(timeline.get_by_text("Waits for db to pass its healthcheck.")).to_be_visible()
        expect(timeline.get_by_role("heading", name="Services with no prerequisites")).to_be_visible()
        step = timeline.locator(".timeline-card").filter(has=page.get_by_role("heading", name="web", exact=True))
        step.get_by_text("Service settings").click()
        binding = step.get_by_text("Publishes container port 80/tcp using host port 8080 on 127.0.0.1.")
        expect(binding).to_be_visible()
        if screenshot_dir:
            page.screenshot(path=target / "composediff-explain.png", full_page=True)
        jump = binding.locator("../..").get_by_role("button", name=re.compile("Go to YAML line"))
        jump.focus()
        jump.press("Enter")
        compose = page.get_by_role("textbox", name="Compose file", exact=True)
        expect(compose).to_be_focused()
        assert "127.0.0.1:8080:80" in compose.evaluate("el => getSelection().anchorNode.parentElement.closest('.cm-line').textContent")

        compose.fill("services: {broken: {depends_on: [missing]}, independent: {image: alpine}}")
        expect(timeline.get_by_role("heading", name="Startup order unknown")).to_be_visible()
        expect(timeline.get_by_text("missing is required but not defined in this file.")).to_be_visible()
        page.get_by_role("button", name="Compare", exact=True).click()
        expect(after).to_contain_text("app0")
        explain.click()
        expect(compose).to_contain_text("broken")
        compose.fill("services:\n  db: [")
        expect(compose).to_have_attribute("aria-invalid", "true")
        expect(timeline.get_by_text("See the error under the editor.")).to_be_visible()
        with page.expect_file_chooser() as chooser:
            page.get_by_role("button", name="Open Compose file").click()
        chooser.value.set_files({
            "name": "single.yml", "mimeType": "text/yaml",
            "buffer": b"services: {single: {image: alpine}}\n",
        })
        expect(timeline.get_by_role("heading", name="single", exact=True)).to_be_visible()
        expect(compose).not_to_have_attribute("aria-invalid", "true")

        page.set_viewport_size({"width": 360, "height": 800})
        page.reload(wait_until="networkidle")
        expect(warning).to_be_visible()
        assert page.evaluate("document.documentElement.scrollWidth === innerWidth")
        assert page.evaluate("!localStorage.length && !sessionStorage.length")
        if screenshot_dir:
            page.screenshot(path=target / "composediff-mobile.png", full_page=True)
        explain.click()
        expect(timeline.get_by_text("Waits for db to pass its healthcheck.")).to_be_visible()
        assert page.evaluate("document.documentElement.scrollWidth === innerWidth")
        if screenshot_dir:
            page.screenshot(path=target / "composediff-explain-mobile.png", full_page=True)
        assert not errors, errors
        assert not failures, failures
        assert all(method == "GET" and request.startswith(url) for method, request in requests), requests
        browser.close()


if __name__ == "__main__":
    dist = Path(__file__).resolve().parents[1] / "dist"
    with TemporaryDirectory() as directory:
        copytree(dist, Path(directory) / "composediff")
        with ThreadingHTTPServer(("127.0.0.1", 0), partial(Handler, directory=directory)) as server:
            thread = Thread(target=server.serve_forever)
            thread.start()
            try:
                check(f"http://127.0.0.1:{server.server_port}/composediff/")
                print("Browser smoke test passed.")
            finally:
                server.shutdown()
                thread.join()
