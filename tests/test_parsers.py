import tempfile
import unittest
from decimal import Decimal
from pathlib import Path

from aggregator.config import load_portfolio_config
from aggregator.models import Holding
from aggregator.parsers.real_estate import RealEstateParser
from aggregator.parsers.tddi import TddiParser
from aggregator.parsers.wealthsimple import WealthsimpleParser
from aggregator.service import discover_csv_files, parse_files


ROOT = Path(__file__).resolve().parents[1]
PORTFOLIO_DIRECTORY = ROOT / "portfolio-sample"
INPUTS = PORTFOLIO_DIRECTORY / "inputs"
PORTFOLIO_CONFIG = load_portfolio_config(PORTFOLIO_DIRECTORY)


class ParserTests(unittest.TestCase):
    def test_sample_files_have_one_parser_and_expected_holding_counts(self):
        holdings = parse_files(discover_csv_files(PORTFOLIO_DIRECTORY), PORTFOLIO_CONFIG)
        self.assertEqual(len(holdings), 6)

    def test_tddi_uses_account_base_currency_for_cash_and_securities(self):
        holdings = TddiParser().parse(INPUTS / "tddi-sample.csv", PORTFOLIO_CONFIG)
        self.assertTrue(all(holding.currency == "USD" for holding in holdings))
        cash = next(holding for holding in holdings if holding.symbol == "CASH-USD")
        self.assertEqual(cash.market_value, Decimal("2500.00"))
        self.assertEqual(cash.account_column, "Sample A")

    def test_wealthsimple_uses_configured_account_mapping(self):
        holdings = WealthsimpleParser().parse(
            INPUTS / "wealthsimple-sample.csv", PORTFOLIO_CONFIG
        )
        self.assertIn("Sample B", {holding.account_column for holding in holdings})

    def test_real_estate_uses_row_metadata_and_real_estate_account(self):
        holdings = RealEstateParser().parse(INPUTS / "real-estates.csv", PORTFOLIO_CONFIG)
        self.assertEqual(holdings, [Holding(
            "Example Rental Property", "CAD", "Sample Property", Decimal("450000.00"),
            asset_type="Real Estate", market="Canada", sector="Real Estate", risk="Medium",
            yield_percent=Decimal("4.00"),
            url="https://example.com/sample-property",
        )])

    def test_real_estate_calculates_yield_from_net_monthly_income(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "real-estates.csv"
            path.write_text(
                "Name,Market,Risk,Currency,Value,Net Monthly Income,URL\n"
                "Property,Canada,Low,CAD,100000,500,https://example.com/property\n",
                encoding="utf-8",
            )
            self.assertEqual(
                RealEstateParser().parse(path, PORTFOLIO_CONFIG)[0].yield_percent,
                Decimal("6"),
            )

    def test_real_estate_rejects_unsafe_url_scheme(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "real-estates.csv"
            path.write_text(
                "Name,Market,Risk,Currency,Value,Net Monthly Income,URL\n"
                "Property,Canada,Low,CAD,100000,500,javascript:alert(1)\n",
                encoding="utf-8",
            )
            with self.assertRaisesRegex(ValueError, "absolute HTTP or HTTPS URL"):
                RealEstateParser().parse(path, PORTFOLIO_CONFIG)

    def test_portfolio_directory_requires_inputs_subdirectory(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, "Inputs directory does not exist"):
                discover_csv_files(Path(directory))


if __name__ == "__main__":
    unittest.main()
