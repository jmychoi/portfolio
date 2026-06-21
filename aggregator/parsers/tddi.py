import csv
import re
from decimal import Decimal, InvalidOperation
from pathlib import Path

from aggregator.config import PortfolioConfig
from aggregator.models import Holding
from aggregator.parsers.base import InputParser


class TddiParser(InputParser):
    ACCOUNT_PATTERN = re.compile(r"TD Direct Investing\s*-\s*(\S+)", re.IGNORECASE)

    def can_parse(self, path: Path) -> bool:
        with path.open(encoding="utf-8-sig", newline="") as source:
            rows = list(csv.reader(source))
        return any(row and row[0] == "Account" and len(row) > 1
                   and self.ACCOUNT_PATTERN.search(row[1]) for row in rows[:10])

    def parse(self, path: Path, config: PortfolioConfig) -> list[Holding]:
        with path.open(encoding="utf-8-sig", newline="") as source:
            rows = list(csv.reader(source))

        account_number = self._account_number(path, rows)
        try:
            account = config.tddi_accounts[account_number]
        except KeyError as exc:
            raise ValueError(
                f"{path}: TD account {account_number!r} is missing from inputs/config.json"
            ) from exc
        account_column = account.account_column
        currency = account.currency

        holdings = []
        cash_row = next((row for row in rows[:10] if row and row[0] == "Cash"), None)
        if cash_row and len(cash_row) > 1 and cash_row[1].strip():
            holdings.append(Holding(
                symbol=f"CASH-{currency}",
                currency=currency,
                account_column=account_column,
                market_value=self._decimal(path, "cash balance", cash_row[1]),
            ))

        header_index = next(
            (index for index, row in enumerate(rows) if row and row[0] == "Symbol"), None
        )
        if header_index is None:
            raise ValueError(f"{path}: TD holdings header was not found")
        header = rows[header_index]
        try:
            symbol_index = header.index("Symbol")
            value_index = header.index("Market Value")
        except ValueError as exc:
            raise ValueError(f"{path}: TD holdings columns are incomplete") from exc

        for row_number, row in enumerate(rows[header_index + 1:], start=header_index + 2):
            if not row or symbol_index >= len(row) or not row[symbol_index].strip():
                continue
            if value_index >= len(row):
                raise ValueError(f"{path}:{row_number}: market value is missing")
            holdings.append(Holding(
                symbol=row[symbol_index].strip(),
                currency=currency,
                account_column=account_column,
                market_value=self._decimal(path, f"row {row_number} market value", row[value_index]),
            ))
        return holdings

    def _account_number(self, path: Path, rows: list[list[str]]) -> str:
        for row in rows[:10]:
            if row and row[0] == "Account" and len(row) > 1:
                match = self.ACCOUNT_PATTERN.search(row[1])
                if match:
                    return match.group(1)
        raise ValueError(f"{path}: TD account number was not found")

    @staticmethod
    def _decimal(path: Path, label: str, raw_value: str) -> Decimal:
        try:
            return Decimal(raw_value.strip())
        except InvalidOperation as exc:
            raise ValueError(f"{path}: invalid {label}: {raw_value!r}") from exc
