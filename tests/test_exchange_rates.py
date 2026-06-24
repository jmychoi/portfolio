import tempfile
import unittest
from decimal import Decimal
from pathlib import Path

from aggregator.exchange_rates import ExchangeRate, ensure_fx_file, load_fx_file


class ExchangeRateTests(unittest.TestCase):
    def test_missing_fx_file_is_created_then_loaded(self):
        observation = ExchangeRate("USD", Decimal("1.4171"), "2026-06-19", "Bank of Canada")
        with tempfile.TemporaryDirectory() as directory:
            fx_path = ensure_fx_file(Path(directory), fetcher=lambda: observation)
            self.assertEqual(fx_path, Path(directory) / "cache" / "fx.csv")
            records = load_fx_file(fx_path)
            self.assertEqual(records["CAD"].rate_to_cad, Decimal("1"))
            self.assertEqual(records["USD"], observation)

    def test_existing_fx_file_does_not_fetch(self):
        observation = ExchangeRate("USD", Decimal("1.4"), "2026-06-18", "Manual")
        with tempfile.TemporaryDirectory() as directory:
            portfolio_directory = Path(directory)
            ensure_fx_file(portfolio_directory, fetcher=lambda: observation)

            def unexpected_fetch():
                self.fail("existing fx.csv should be reused")

            ensure_fx_file(portfolio_directory, fetcher=unexpected_fetch)

    def test_malformed_existing_fx_file_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            fx_path = Path(directory) / "cache" / "fx.csv"
            fx_path.parent.mkdir()
            fx_path.write_text("Currency,Rate CAD\nUSD,not-a-number\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "expected columns"):
                load_fx_file(fx_path)


if __name__ == "__main__":
    unittest.main()
