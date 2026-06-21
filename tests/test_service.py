import csv
import tempfile
import unittest
from dataclasses import replace
from decimal import Decimal
from pathlib import Path
from types import MappingProxyType

from aggregator.config import AssetMetadata, load_portfolio_config
from aggregator.models import Holding
from aggregator.service import aggregate, output_columns, write_csv


TEST_RATES = {"CAD": Decimal("1"), "USD": Decimal("1.415")}
SAMPLE_CONFIG = load_portfolio_config(Path(__file__).resolve().parents[1] / "portfolio-sample")
TEST_ASSETS = dict(SAMPLE_CONFIG.assets)
TEST_ASSETS.update({
    "ATZ": AssetMetadata("Stock", "Canada", "Retail", "High"),
    "NVDA": AssetMetadata("Stock", "US", "Technology", "High"),
    "QQC": AssetMetadata("ETF", "US", "Mixed", "Medium"),
    "RY": AssetMetadata("Stock", "Canada", "Finance", "Medium"),
})
TEST_CONFIG = replace(SAMPLE_CONFIG, assets=MappingProxyType(TEST_ASSETS))


def aggregate_holdings(holdings):
    return aggregate(holdings, TEST_RATES, TEST_CONFIG)


class AggregationTests(unittest.TestCase):
    def test_asset_metadata_is_one_complete_record(self):
        self.assertEqual(
            TEST_ASSETS["GOOG"],
            AssetMetadata("Stock", "US", "Technology", "Medium"),
        )

    def test_ai_oriented_assets_use_the_broad_technology_sector(self):
        self.assertEqual(TEST_ASSETS["NVDA"].sector, "Technology")

    def test_cash_rows_always_exist(self):
        by_symbol = {row["Asset"]: row for row in aggregate_holdings([])}
        self.assertEqual(set(by_symbol), {"CASH-CAD", "CASH-USD"})
        self.assertEqual(by_symbol["CASH-CAD"]["Total"], "0.00")
        self.assertEqual(by_symbol["CASH-USD"]["Total"], "0.00")
        self.assertEqual(by_symbol["CASH-CAD"]["Yield"], "0.00")
        self.assertEqual(by_symbol["CASH-USD"]["Projected Annual Income"], "0.00")
        self.assertEqual(by_symbol["CASH-CAD"]["FX Rate CAD"], "1")
        self.assertEqual(by_symbol["CASH-USD"]["FX Rate CAD"], "1.415")

    def test_aggregation_and_percentage_use_cad_total(self):
        holdings = [
            Holding("GOOG", "USD", "Sample A", Decimal("100")),
            Holding("GOOG", "USD", "Sample B", Decimal("100")),
            Holding("ATZ", "CAD", "Sample A", Decimal("283")),
        ]
        rows = {row["Asset"]: row for row in aggregate_holdings(holdings)}
        self.assertEqual(rows["GOOG"]["Total"], "200.00")
        self.assertEqual(rows["GOOG"]["Total CAD"], "283.00")
        self.assertEqual(rows["GOOG"]["% Holding"], "50.00")
        self.assertEqual(rows["ATZ"]["% Holding"], "50.00")

    def test_details_are_sorted_by_percentage_descending(self):
        holdings = [
            Holding("CASH-CAD", "CAD", "Sample A", Decimal("5")),
            Holding("ATZ", "CAD", "Sample A", Decimal("100")),
            Holding("BMO", "CAD", "Sample A", Decimal("200")),
            Holding("RY", "CAD", "Sample A", Decimal("300")),
            Holding("QQC", "CAD", "Sample A", Decimal("400")),
            Holding("Property", "CAD", "Sample Property", Decimal("500"),
                    asset_type="Real Estate", market="Canada", sector="Real Estate", risk="Medium"),
        ]
        self.assertEqual(
            [row["Asset"] for row in aggregate_holdings(holdings)],
            ["Property", "QQC", "RY", "BMO", "ATZ", "CASH-CAD", "CASH-USD"],
        )

    def test_equal_percentages_use_asset_as_tie_breaker(self):
        rows = aggregate_holdings([
            Holding("ATZ", "CAD", "Sample A", Decimal("100")),
            Holding("BMO", "CAD", "Sample A", Decimal("100")),
        ])
        self.assertEqual([row["Asset"] for row in rows], ["ATZ", "BMO", "CASH-CAD", "CASH-USD"])

    def test_numeric_values_have_expected_precision(self):
        rows = {row["Asset"]: row for row in aggregate_holdings([
            Holding("GOOG", "USD", "Sample A", Decimal("1.234567")),
            Holding("ATZ", "CAD", "Sample A", Decimal("1")),
        ])}
        self.assertEqual(rows["GOOG"]["Total"], "1.23")
        self.assertEqual(rows["GOOG"]["Total CAD"], "1.75")
        self.assertEqual(len(rows["GOOG"]["% Holding"].split(".")[1]), 2)
        self.assertEqual(rows["GOOG"]["FX Rate CAD"], "1.415")

    def test_unknown_asset_fails_explicitly(self):
        with self.assertRaisesRegex(ValueError, "missing deterministic classification"):
            aggregate_holdings([Holding("UNKNOWN", "CAD", "Sample A", Decimal("1"))])

    def test_missing_fx_rate_fails_explicitly(self):
        with self.assertRaisesRegex(ValueError, "No CAD exchange rate found"):
            aggregate(
                [Holding("GOOG", "USD", "Sample A", Decimal("1"))],
                {"CAD": Decimal("1")},
                TEST_CONFIG,
            )

    def test_currency_comes_from_the_parsed_holding(self):
        rows = aggregate(
            [Holding("GOOG", "CAD", "Sample A", Decimal("10"))],
            TEST_RATES,
            TEST_CONFIG,
        )
        goog = next(row for row in rows if row["Asset"] == "GOOG")
        self.assertEqual(goog["Currency"], "CAD")
        self.assertEqual(goog["Total CAD"], "10.00")

    def test_market_and_real_estate_yields_are_serialized(self):
        holdings = [
            Holding("GOOG", "USD", "Sample A", Decimal("10")),
            Holding("Property", "CAD", "Sample Property", Decimal("100"),
                    asset_type="Real Estate", market="Canada", sector="Real Estate",
                    risk="Medium", yield_percent=Decimal("4.125")),
        ]
        rows = {
            row["Asset"]: row
            for row in aggregate(
                holdings,
                TEST_RATES,
                TEST_CONFIG,
                {"GOOG": Decimal("0.678")},
                {"GOOG": "https://finance.yahoo.com/quote/GOOG"},
            )
        }
        self.assertEqual(rows["GOOG"]["Yield"], "0.68")
        self.assertEqual(rows["Property"]["Yield"], "4.13")
        self.assertEqual(rows["GOOG"]["Projected Annual Income"], "0.10")
        self.assertEqual(rows["Property"]["Projected Annual Income"], "4.13")
        self.assertEqual(rows["GOOG"]["URL"], "https://finance.yahoo.com/quote/GOOG")
        self.assertEqual(rows["Property"]["URL"], "")

    def test_output_has_exact_column_order(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "portfolio.csv"
            write_csv(aggregate_holdings([]), output, TEST_CONFIG.account_columns)
            with output.open(encoding="utf-8", newline="") as source:
                reader = csv.reader(source)
                expected = output_columns(TEST_CONFIG.account_columns)
                self.assertEqual(tuple(next(reader)), expected)
                self.assertEqual(len(next(reader)), len(expected))

    def test_every_account_column_is_present(self):
        row = aggregate_holdings([])[0]
        self.assertTrue(all(column in row for column in TEST_CONFIG.account_columns))


if __name__ == "__main__":
    unittest.main()
