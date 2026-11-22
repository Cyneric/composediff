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
        page.get_by_role("button", name="Source diff").click()
        expect(page.get_by_role("region", name="Source diff lines")).to_contain_text("db: [")
        after.fill("services:\n  db:\n    image: postgres:16\n    environment: [TOKEN=after-secret]\n")
        page.get_by_role("button", name="Changes", exact=True).click()
        expect(page.get_by_role("heading", name="Environment variables updated")).to_be_visible()
        expect(after).not_to_have_attribute("aria-invalid", "true")
        page.get_by_role("button", name="Copy Markdown").click()
        expect(page.get_by_text("Markdown copied. Check for secrets before sharing.")).to_be_visible()
        assert "TOKEN" not in page.evaluate("navigator.clipboard.readText()")

        page.get_by_role("region", name="Before", exact=True).dispatch_event("drop", {
            "dataTransfer": page.evaluate_handle("""() => {
                const transfer = new DataTransfer()
                transfer.items.add(new File(['services: {}\\n'], 'dropped.yaml', {type: 'text/yaml'}))
                return transfer
            }"""),
        })
        expect(page.get_by_text("dropped.yaml", exact=True)).to_be_visible()
        expect(before).to_contain_text("services: {}")
        expect(page.get_by_role("heading", name="Service added")).to_be_visible()

        page.set_viewport_size({"width": 360, "height": 800})
        page.reload(wait_until="networkidle")
        expect(warning).to_be_visible()
        assert page.evaluate("document.documentElement.scrollWidth === innerWidth")
        assert page.evaluate("!localStorage.length && !sessionStorage.length")
        if screenshot_dir:
            page.screenshot(path=target / "composediff-mobile.png", full_page=True)
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
