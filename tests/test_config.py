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


class PortfolioConfigTests(unittest.TestCase):
    def test_sample_configuration_loads_typed_immutable_mappings(self):
        config = load_portfolio_config(ROOT / "portfolio-sample")
        self.assertEqual(
            config.tddi_accounts["SAMPLE123"],
            TddiAccount("Sample A", "USD"),
        )
        self.assertIn("Sample A", config.account_columns)
        self.assertEqual(config.real_estate_account, "Sample Property")
        self.assertEqual(
            config.wealthsimple_account_types["TFSA"], "Sample B"
        )
        self.assertEqual(
            config.assets["MSFT"],
            AssetMetadata("Stock", "US", "Technology", "Medium"),
        )
        with self.assertRaises(TypeError):
            config.assets["NEW"] = AssetMetadata("Stock", "US", "Technology", "Low")

    def test_missing_configuration_fails_clearly(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, "configuration does not exist"):
                load_portfolio_config(Path(directory))

    def test_complete_configuration_document_is_available_for_snapshot(self):
        document = load_portfolio_config_document(ROOT / "portfolio-sample")
        self.assertEqual(document["real_estate_account"], "Sample Property")
        self.assertIn("MSFT", document["assets"])

    def test_duplicate_json_key_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "inputs" / "config.json"
            path.parent.mkdir()
            sample = (ROOT / "portfolio-sample" / "inputs" / "config.json").read_text(
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
                (ROOT / "portfolio-sample" / "inputs" / "config.json").read_text(
                    encoding="utf-8"
                )
            )
            del raw["assets"]["MSFT"]["sector"]
            path.write_text(json.dumps(raw), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "missing keys: sector"):
                load_portfolio_config(Path(directory))


if __name__ == "__main__":
    unittest.main()
