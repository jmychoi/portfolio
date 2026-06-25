import json
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path

from collect import build_collection_document, load_portfolios


ROOT = Path(__file__).resolve().parents[1]
SAMPLE = json.loads(
    (ROOT / "sample" / "2026-01-02.json").read_text(encoding="utf-8")
)


class HistoryBuilderTests(unittest.TestCase):
    def write_portfolio(self, directory: Path, name: str, portfolio_date: str) -> Path:
        document = deepcopy(SAMPLE)
        document["date"] = portfolio_date
        path = directory / name
        path.write_text(json.dumps(document), encoding="utf-8")
        return path

    def test_portfolios_are_sorted_by_embedded_date_and_output_is_ignored(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            self.write_portfolio(directory, "later.json", "2026-02-28")
            self.write_portfolio(directory, "earlier.json", "2026-01-31")
            output = directory / "portfolios.json"
            output.write_text('{"old":true}', encoding="utf-8")
            portfolios = load_portfolios(directory, output)
            self.assertEqual(
                [portfolio["date"] for portfolio in portfolios],
                ["2026-01-31", "2026-02-28"],
            )
            self.assertEqual(build_collection_document(portfolios), {
                "schemaVersion": 1,
                "kind": "portfolioCollection",
                "portfolios": portfolios,
            })

    def test_duplicate_dates_are_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            self.write_portfolio(directory, "one.json", "2026-01-31")
            self.write_portfolio(directory, "two.json", "2026-01-31")
            with self.assertRaisesRegex(ValueError, "Duplicate portfolio date"):
                load_portfolios(directory, directory / "portfolios.json")

    def test_negative_holding_value_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            document = deepcopy(SAMPLE)
            document["holdings"][0]["accounts"] = {"Sample Joint": -1}
            (directory / "bad.json").write_text(json.dumps(document), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "must be non-negative"):
                load_portfolios(directory, directory / "portfolios.json")

    def test_negative_yield_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            document = deepcopy(SAMPLE)
            asset = document["holdings"][0]["asset"]
            document["yields"][asset]["percent"] = -1
            (directory / "bad.json").write_text(json.dumps(document), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "yield .* must be non-negative"):
                load_portfolios(directory, directory / "portfolios.json")

    def test_non_portfolio_json_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            (directory / "notes.json").write_text("{}", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "expected portfolio schema version"):
                load_portfolios(directory, directory / "portfolios.json")


if __name__ == "__main__":
    unittest.main()
