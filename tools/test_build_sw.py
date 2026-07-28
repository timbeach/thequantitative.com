"""Tests for build_sw.py — the deploy-time precache manifest generator."""
import shutil
import tempfile
import unittest
from pathlib import Path

from build_sw import build, collect_files, file_revision

SW_TEMPLATE = "const CACHE_VERSION = 'dev'; // build_sw.py rewrites this line\n"


class BuildSwTest(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        (self.root / "js").mkdir()
        (self.root / "docs").mkdir()
        (self.root / "index.html").write_text("<!DOCTYPE html>")
        (self.root / "js" / "app.js").write_text("export {}")
        (self.root / "sw.js").write_text(SW_TEMPLATE)
        (self.root / "docs" / "notes.md").write_text("not shipped")

    def tearDown(self):
        shutil.rmtree(self.root)

    def test_collects_shipped_files(self):
        urls = {f.url for f in collect_files(self.root)}
        self.assertIn("/index.html", urls)
        self.assertIn("/js/app.js", urls)

    def test_excludes_non_shipped_directories(self):
        urls = {f.url for f in collect_files(self.root)}
        self.assertNotIn("/docs/notes.md", urls)

    def test_never_precaches_the_worker_or_its_own_output(self):
        urls = {f.url for f in collect_files(self.root)}
        self.assertNotIn("/sw.js", urls)
        self.assertNotIn("/sw-manifest.js", urls)

    def test_revision_changes_when_content_changes(self):
        path = self.root / "js" / "app.js"
        before = file_revision(path)
        path.write_text("export const changed = 1")
        self.assertNotEqual(before, file_revision(path))

    def test_revision_is_stable_for_identical_content(self):
        path = self.root / "js" / "app.js"
        self.assertEqual(file_revision(path), file_revision(path))

    def test_build_writes_manifest_with_urls_and_revisions(self):
        build(self.root)
        out = (self.root / "sw-manifest.js").read_text()
        self.assertIn("self.PRECACHE", out)
        self.assertIn("/index.html", out)
        self.assertIn("self.PRECACHE_VERSION", out)

    def test_build_rewrites_the_cache_version_line_in_sw(self):
        build(self.root)
        sw = (self.root / "sw.js").read_text()
        self.assertNotIn("'dev'", sw)
        self.assertIn("build_sw.py rewrites this line", sw)

    def test_version_changes_when_any_shipped_file_changes(self):
        build(self.root)
        first = (self.root / "sw.js").read_text()
        (self.root / "js" / "app.js").write_text("export const changed = 1")
        build(self.root)
        self.assertNotEqual(first, (self.root / "sw.js").read_text())

    def test_version_is_reproducible_for_unchanged_input(self):
        build(self.root)
        first = (self.root / "sw.js").read_text()
        build(self.root)
        self.assertEqual(first, (self.root / "sw.js").read_text())


if __name__ == "__main__":
    unittest.main()
