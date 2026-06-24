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

    def test_history_page_has_required_controls_and_local_assets(self):
        parser = self.parse("history.html")
        required = {
            "file-input", "dashboard", "metric", "stack-by", "time-frame",
            "start-date", "end-date", "account-options", "chart-container", "chart-legend",
        }
        self.assertTrue(required.issubset(parser.ids))

    def test_portfolio_explorer_uses_local_assets(self):
        parser = self.parse("explorer.html")
        self.assertIn("group-by", parser.ids)
        self.assertIn("explorer/explorer.js", parser.assets)


if __name__ == "__main__":
    unittest.main()
