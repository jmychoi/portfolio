import tempfile
import unittest
from decimal import Decimal
from pathlib import Path

from aggregator.config import load_portfolio_config
from aggregator.models import Holding
from aggregator.parsers.real_estate import RealEstateParser
from aggregator.parsers.rbc import RbcParser
from aggregator.parsers.tddi import TddiParser
from aggregator.parsers.wealthsimple import WealthsimpleParser
from aggregator.service import discover_csv_files, parse_files


ROOT = Path(__file__).resolve().parents[1]
PORTFOLIO_DIRECTORY = ROOT / "sample" / "sources" / "2026-01-02"
INPUTS = PORTFOLIO_DIRECTORY / "inputs"
PORTFOLIO_CONFIG = load_portfolio_config(PORTFOLIO_DIRECTORY)


class ParserTests(unittest.TestCase):
    def test_sample_files_have_one_parser_and_expected_holding_counts(self):
        holdings = parse_files(discover_csv_files(PORTFOLIO_DIRECTORY), PORTFOLIO_CONFIG)
        self.assertEqual(len(holdings), 9)

    def test_tddi_uses_account_base_currency_for_cash_and_securities(self):
        holdings = TddiParser().parse(INPUTS / "tddi-sample.csv", PORTFOLIO_CONFIG)
        self.assertTrue(all(holding.currency == "USD" for holding in holdings))
        cash = next(holding for holding in holdings if holding.symbol == "CASH-USD")
        self.assertEqual(cash.market_value, Decimal("2600.00"))
        self.assertEqual(cash.account_column, "Sample Joint")

    def test_wealthsimple_uses_configured_account_mapping(self):
        holdings = WealthsimpleParser().parse(
            INPUTS / "wealthsimple-sample.csv", PORTFOLIO_CONFIG
        )
        self.assertIn("Sample Registered", {holding.account_column for holding in holdings})

    def test_wealthsimple_rejects_currency_outside_configuration(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "wealthsimple.csv"
            path.write_text(
                "Account Type,Symbol,Market Value,Market Value Currency\n"
                "TFSA,FAKEUS,100,EUR\n",
                encoding="utf-8",
            )
            with self.assertRaisesRegex(ValueError, "unsupported currency 'EUR'"):
                WealthsimpleParser().parse(path, PORTFOLIO_CONFIG)

    def test_rbc_uses_configured_account_mapping_and_row_currency(self):
        holdings = RbcParser().parse(INPUTS / "rbc-sample.csv", PORTFOLIO_CONFIG)
        self.assertEqual(holdings, [
            Holding("CASH-USD", "USD", "Sample Joint", Decimal("123.45")),
            Holding("FUNDGLB", "USD", "Sample Joint", Decimal("1000")),
        ])

    def test_rbc_rejects_unmapped_account(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "rbc.csv"
            path.write_text(
                "Account: UNKNOWN - Investment\n"
                "Currency,Cash,Investments,Short,Total,Exchange Rate to CAD\n"
                "USD,1,0,N/A,1,1.4\n"
                ",Product,Symbol,Name,Quantity,Last Price,Currency,Change $,Change %,"
                "Total Book Cost,Total Market Value\n"
                "USD Holdings,ETFs and ETNs,FUNDGLB,Fund,1,1,USD,0,0%,1,1\n",
                encoding="utf-8",
            )
            with self.assertRaisesRegex(ValueError, "RBC account 'UNKNOWN'"):
                RbcParser().parse(path, PORTFOLIO_CONFIG)

    def test_real_estate_uses_row_metadata_and_real_estate_account(self):
        holdings = RealEstateParser().parse(INPUTS / "real-estates.csv", PORTFOLIO_CONFIG)
        self.assertEqual(holdings, [Holding(
            "Fictional Duplex", "CAD", "Sample Property", Decimal("445000.00"),
            asset_type="Real Estate", market="Canada", sector="Real Estate", risk="Medium",
            yield_percent=Decimal("3.775280898876404494382022472"),
            url="https://example.com/fictional-duplex",
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
