import json
import tempfile
import unittest
from dataclasses import replace
from decimal import Decimal
from pathlib import Path
from types import MappingProxyType

from aggregator.config import AssetMetadata, load_portfolio_config, load_portfolio_config_document
from aggregator.exchange_rates import ExchangeRate
from aggregator.models import Holding
from aggregator.service import build_portfolio_document, write_portfolio_json
from aggregator.yields import YieldRecord


ROOT = Path(__file__).resolve().parents[1]
SAMPLE_DIRECTORY = ROOT / "portfolio-sample"
SAMPLE_CONFIG = load_portfolio_config(SAMPLE_DIRECTORY)
SAMPLE_DOCUMENT = load_portfolio_config_document(SAMPLE_DIRECTORY)
TEST_ASSETS = dict(SAMPLE_CONFIG.assets)
TEST_ASSETS.update({
    "ATZ": AssetMetadata("Stock", "Canada", "Retail", "High"),
    "NVDA": AssetMetadata("Stock", "US", "Technology", "High"),
})
TEST_CONFIG = replace(SAMPLE_CONFIG, assets=MappingProxyType(TEST_ASSETS))
TEST_CONFIGURATION = {**SAMPLE_DOCUMENT, "assets": {
    **SAMPLE_DOCUMENT["assets"],
    "ATZ": {"type": "Stock", "market": "Canada", "sector": "Retail", "risk": "High"},
    "NVDA": {"type": "Stock", "market": "US", "sector": "Technology", "risk": "High"},
}}
TEST_RATES = {
    "CAD": ExchangeRate("CAD", Decimal("1"), "", ""),
    "USD": ExchangeRate("USD", Decimal("1.415"), "2026-06-19", "test"),
}


def build(holdings, yields=None):
    return build_portfolio_document(
        holdings, TEST_RATES, TEST_CONFIG, TEST_CONFIGURATION, yields or {}
    )


class PortfolioDocumentTests(unittest.TestCase):
    def test_configuration_is_embedded_without_flattened_metadata(self):
        document = build([Holding("GOOG", "USD", "Sample A", Decimal("10"))])
        self.assertEqual(document["configuration"], TEST_CONFIGURATION)
        holding = next(item for item in document["holdings"] if item["asset"] == "GOOG")
        self.assertEqual(holding, {
            "asset": "GOOG", "currency": "USD", "accounts": {"Sample A": Decimal("10")},
        })
        self.assertNotIn("type", holding)
        self.assertNotIn("total", holding)

    def test_cash_rows_always_exist_with_fixed_yields(self):
        document = build([])
        self.assertEqual(
            {holding["asset"] for holding in document["holdings"]},
            {"CASH-CAD", "CASH-USD"},
        )
        self.assertEqual(document["yields"]["CASH-CAD"]["percent"], Decimal("0"))
        self.assertEqual(document["supplementalAssets"]["CASH-USD"]["type"], "Cash")

    def test_holdings_aggregate_exact_values_without_derived_fields(self):
        document = build([
            Holding("GOOG", "USD", "Sample A", Decimal("1.234567")),
            Holding("GOOG", "USD", "Sample B", Decimal("2")),
        ])
        holding = next(item for item in document["holdings"] if item["asset"] == "GOOG")
        self.assertEqual(holding["accounts"], {
            "Sample A": Decimal("1.234567"), "Sample B": Decimal("2"),
        })
        self.assertEqual(set(holding), {"asset", "currency", "accounts"})

    def test_market_yield_cache_is_embedded_with_provenance(self):
        record = YieldRecord("GOOG", "GOOG", Decimal("0.678"), "2026-06-19", "test", "ok")
        document = build(
            [Holding("GOOG", "USD", "Sample A", Decimal("10"))],
            {"GOOG": record},
        )
        self.assertEqual(document["yields"]["GOOG"], {
            "providerSymbol": "GOOG", "percent": Decimal("0.678"),
            "asOf": "2026-06-19", "source": "test", "status": "ok",
        })

    def test_real_estate_uses_supplemental_metadata(self):
        document = build([Holding(
            "Property", "CAD", "Sample Property", Decimal("100"),
            asset_type="Real Estate", market="Canada", sector="Real Estate",
            risk="Medium", yield_percent=Decimal("4.125"),
            url="https://example.com/property",
        )])
        self.assertEqual(document["supplementalAssets"]["Property"], {
            "type": "Real Estate", "market": "Canada", "sector": "Real Estate",
            "risk": "Medium", "url": "https://example.com/property",
        })
        self.assertEqual(document["yields"]["Property"]["percent"], Decimal("4.125"))

    def test_unknown_asset_fails_explicitly(self):
        with self.assertRaisesRegex(ValueError, "missing deterministic classification"):
            build([Holding("UNKNOWN", "CAD", "Sample A", Decimal("1"))])

    def test_missing_fx_rate_fails_explicitly(self):
        with self.assertRaisesRegex(ValueError, "No CAD exchange rate found"):
            build_portfolio_document(
                [Holding("GOOG", "USD", "Sample A", Decimal("1"))],
                {"CAD": TEST_RATES["CAD"]}, TEST_CONFIG, TEST_CONFIGURATION, {},
            )

    def test_json_writer_emits_numbers_and_schema(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "portfolio.json"
            write_portfolio_json(build([]), output)
            document = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(document["schemaVersion"], 1)
            self.assertIsInstance(document["exchangeRates"]["USD"]["rateToCad"], float)


if __name__ == "__main__":
    unittest.main()
