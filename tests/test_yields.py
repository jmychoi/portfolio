import tempfile
import unittest
from decimal import Decimal
from pathlib import Path

from aggregator.asset_urls import yahoo_finance_url
from aggregator.yields import (
    YieldRecord,
    annualized_latest_yield,
    ensure_yields_file,
    load_yields_file,
    yfinance_symbol,
)


class YieldTests(unittest.TestCase):
    def test_annualizes_latest_distribution_using_previous_year_count(self):
        result = annualized_latest_yield(
            Decimal("100"),
            [Decimal("0.20"), Decimal("0.22"), Decimal("0.24"), Decimal("0.25")],
        )
        self.assertEqual(result, Decimal("1.00"))

    def test_no_distributions_means_zero_yield(self):
        self.assertEqual(annualized_latest_yield(Decimal("100"), []), Decimal("0"))

    def test_yfinance_symbol_translation(self):
        self.assertEqual(yfinance_symbol("MSFT", "USD"), "MSFT")
        self.assertEqual(yfinance_symbol("BMO", "CAD"), "BMO.TO")
        self.assertEqual(yfinance_symbol("HISU.U", "USD"), "HISU-U.TO")
        self.assertEqual(
            yahoo_finance_url("HISU-U.TO"),
            "https://finance.yahoo.com/quote/HISU-U.TO",
        )

    def test_missing_assets_are_fetched_and_cached(self):
        expected = YieldRecord("MSFT", "MSFT", Decimal("0.75"), "2026-06-19", "test", "ok")
        with tempfile.TemporaryDirectory() as directory:
            path = ensure_yields_file(
                Path(directory), {"MSFT": "MSFT"},
                fetcher=lambda assets: {"MSFT": expected},
            )
            self.assertEqual(path, Path(directory) / "cache" / "yields.csv")
            self.assertEqual(load_yields_file(path)["MSFT"], expected)

    def test_cached_assets_are_not_fetched_again(self):
        record = YieldRecord("MSFT", "MSFT", Decimal("0.75"), "2026-06-19", "test", "ok")
        with tempfile.TemporaryDirectory() as directory:
            portfolio_directory = Path(directory)
            ensure_yields_file(portfolio_directory, {"MSFT": "MSFT"}, fetcher=lambda assets: {"MSFT": record})

            def unexpected_fetch(assets):
                self.fail("cached yield should be reused")

            ensure_yields_file(portfolio_directory, {"MSFT": "MSFT"}, fetcher=unexpected_fetch)

    def test_unavailable_yield_remains_blank_in_cache(self):
        record = YieldRecord("PRIVATE", "PRIVATE", None, "", "yfinance", "unavailable")
        with tempfile.TemporaryDirectory() as directory:
            path = ensure_yields_file(
                Path(directory), {"PRIVATE": "PRIVATE"},
                fetcher=lambda assets: {"PRIVATE": record},
            )
            self.assertIsNone(load_yields_file(path)["PRIVATE"].yield_percent)

    def test_refresh_status_retries_with_cached_provider_symbol(self):
        initial = YieldRecord("ASSET", "CUSTOM", None, "", "manual", "refresh")
        refreshed = YieldRecord("ASSET", "CUSTOM", Decimal("2.5"), "2026-06-19", "test", "ok")
        with tempfile.TemporaryDirectory() as directory:
            portfolio_directory = Path(directory)
            ensure_yields_file(
                portfolio_directory, {"ASSET": "DEFAULT"},
                fetcher=lambda assets: {"ASSET": initial},
            )
            observed = {}

            def refresh(assets):
                observed.update(assets)
                return {"ASSET": refreshed}

            ensure_yields_file(portfolio_directory, {"ASSET": "DEFAULT"}, fetcher=refresh)
            self.assertEqual(observed, {"ASSET": "CUSTOM"})
            self.assertEqual(
                load_yields_file(portfolio_directory / "cache" / "yields.csv")["ASSET"],
                refreshed,
            )


if __name__ == "__main__":
    unittest.main()
