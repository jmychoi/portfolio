import unittest
from html.parser import HTMLParser
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class PageParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids = []
        self.assets = []

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if "id" in values:
            self.ids.append(values["id"])
        if tag == "script" and values.get("src"):
            self.assets.append(values["src"])
        if tag == "link" and values.get("href"):
            self.assets.append(values["href"])


class StaticPageTests(unittest.TestCase):
    def parse(self, name: str) -> PageParser:
        parser = PageParser()
        parser.feed((ROOT / name).read_text(encoding="utf-8"))
        self.assertEqual(len(parser.ids), len(set(parser.ids)), f"duplicate IDs in {name}")
        for asset in parser.assets:
            self.assertTrue((ROOT / asset).is_file(), f"missing {asset} referenced by {name}")
        return parser

    def test_portfolio_explorer_has_snapshot_and_history_controls(self):
        parser = self.parse("explorer.html")
        required = {
            "file-input", "dashboard", "view-mode", "snapshot-select",
            "group-by", "account-options", "table-body", "pie-container",
            "history-metric", "history-stack-by", "history-time-frame",
            "history-start-date", "history-end-date", "history-account-options",
            "history-chart-container", "history-chart-legend",
        }
        self.assertTrue(required.issubset(parser.ids))

    def test_portfolio_explorer_uses_local_assets(self):
        parser = self.parse("explorer.html")
        self.assertIn("group-by", parser.ids)
        self.assertIn("explorer/explorer.js", parser.assets)
        self.assertIn("explorer/collection-model.js", parser.assets)


if __name__ == "__main__":
    unittest.main()
