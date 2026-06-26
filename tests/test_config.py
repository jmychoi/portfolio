import json
import tempfile
import unittest
from pathlib import Path

from aggregator.config import (
    AssetMetadata,
    TddiAccount,
    load_portfolio_config,
    load_portfolio_config_document,
)


ROOT = Path(__file__).resolve().parents[1]
SAMPLE_SOURCE = ROOT / "sample" / "sources" / "2026-01-02"


class PortfolioConfigTests(unittest.TestCase):
    def test_sample_configuration_loads_typed_immutable_mappings(self):
        config = load_portfolio_config(SAMPLE_SOURCE)
        self.assertEqual(
            config.tddi_accounts["DEMOUSD"],
            TddiAccount("Sample Joint", "USD"),
        )
        self.assertEqual(config.rbc_accounts["DEMO123"], "Sample Joint")
        self.assertEqual(config.symbol_aliases["FUNDALT"], "FUNDGLB")
        self.assertIn("Sample Joint", config.account_columns)
        self.assertEqual(config.real_estate_account, "Sample Property")
        self.assertEqual(
            config.wealthsimple_account_types["TFSA"], "Sample Registered"
        )
        self.assertEqual(
            config.assets["FAKEAI"],
            AssetMetadata("Stock", "US", "Technology", "High", "USD"),
        )
        self.assertEqual(config.allowed_currencies, frozenset({"CAD", "USD"}))
        with self.assertRaises(TypeError):
            config.assets["NEW"] = AssetMetadata(
                "Stock", "US", "Technology", "Low", "USD"
            )

    def test_missing_configuration_fails_clearly(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, "configuration does not exist"):
                load_portfolio_config(Path(directory))

    def test_complete_configuration_document_is_available_for_snapshot(self):
        document = load_portfolio_config_document(SAMPLE_SOURCE)
        self.assertEqual(document["real_estate_account"], "Sample Property")
        self.assertIn("FAKEAI", document["assets"])

    def test_duplicate_json_key_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "inputs" / "config.json"
            path.parent.mkdir()
            sample = (SAMPLE_SOURCE / "inputs" / "config.json").read_text(
                encoding="utf-8"
            )
            path.write_text(
                sample.replace('"type": "Stock"', '"type": "Stock", "type": "ETF"', 1),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(ValueError, "duplicate key 'type'"):
                load_portfolio_config(Path(directory))

    def test_incomplete_asset_metadata_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "inputs" / "config.json"
            path.parent.mkdir()
            raw = json.loads(
                (SAMPLE_SOURCE / "inputs" / "config.json").read_text(
                    encoding="utf-8"
                )
            )
            del raw["assets"]["FAKEAI"]["sector"]
            path.write_text(json.dumps(raw), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "missing keys: sector"):
                load_portfolio_config(Path(directory))

    def test_unsupported_asset_currency_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "inputs" / "config.json"
            path.parent.mkdir()
            raw = json.loads(
                (SAMPLE_SOURCE / "inputs" / "config.json").read_text(
                    encoding="utf-8"
                )
            )
            raw["assets"]["FAKEAI"]["currency"] = "EUR"
            path.write_text(json.dumps(raw), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "unsupported currency 'EUR'"):
                load_portfolio_config(Path(directory))

    def test_allowed_currencies_require_uppercase_codes_and_cad(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "inputs" / "config.json"
            path.parent.mkdir()
            raw = json.loads(
                (SAMPLE_SOURCE / "inputs" / "config.json").read_text(
                    encoding="utf-8"
                )
            )
            raw["allowed_currencies"] = ["USD", "cad"]
            path.write_text(json.dumps(raw), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "uppercase three-letter"):
                load_portfolio_config(Path(directory))


if __name__ == "__main__":
    unittest.main()
