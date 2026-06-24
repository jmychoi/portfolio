import csv
from decimal import Decimal, InvalidOperation
from pathlib import Path

from aggregator.config import PortfolioConfig
from aggregator.models import Holding
from aggregator.parsers.base import InputParser


class WealthsimpleParser(InputParser):
    REQUIRED_COLUMNS = {"Account Type", "Symbol", "Market Value", "Market Value Currency"}

    def can_parse(self, path: Path) -> bool:
        with path.open(encoding="utf-8-sig", newline="") as source:
            header = next(csv.reader(source), [])
        return self.REQUIRED_COLUMNS.issubset(header)

    def parse(self, path: Path, config: PortfolioConfig) -> list[Holding]:
        holdings = []
        with path.open(encoding="utf-8-sig", newline="") as source:
            for row_number, row in enumerate(csv.DictReader(source), start=2):
                symbol = (row.get("Symbol") or "").strip()
                if not symbol:  # Wealthsimple's final "as of" metadata row.
                    continue
                account_type = (row.get("Account Type") or "").strip()
                try:
                    account_column = config.wealthsimple_account_types[account_type]
                except KeyError as exc:
                    raise ValueError(
                        f"{path}:{row_number}: unmapped Wealthsimple account type {account_type!r}"
                    ) from exc
                try:
                    value = Decimal(row["Market Value"].strip())
                except (InvalidOperation, AttributeError) as exc:
                    raise ValueError(f"{path}:{row_number}: invalid market value") from exc
                currency = (row.get("Market Value Currency") or "").strip().upper()
                if currency not in config.allowed_currencies:
                    raise ValueError(
                        f"{path}:{row_number}: unsupported currency {currency!r}; "
                        f"expected one of {sorted(config.allowed_currencies)}"
                    )
                holdings.append(Holding(
                    symbol=symbol,
                    currency=currency,
                    account_column=account_column,
                    market_value=value,
                ))
        return holdings
