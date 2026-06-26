import csv
import re
from decimal import Decimal, InvalidOperation
from pathlib import Path

from aggregator.config import PortfolioConfig
from aggregator.models import Holding
from aggregator.parsers.base import InputParser


class RbcParser(InputParser):
    ACCOUNT_PATTERN = re.compile(r"^Account:\s*(\S+)\s*-", re.IGNORECASE)
    HOLDINGS_HEADER_PREFIX = ["", "Product", "Symbol", "Name"]

    def can_parse(self, path: Path) -> bool:
        with path.open(encoding="utf-8-sig", newline="") as source:
            rows = list(csv.reader(source))
        return any(row and self.ACCOUNT_PATTERN.search(row[0]) for row in rows[:10])

    def parse(self, path: Path, config: PortfolioConfig) -> list[Holding]:
        with path.open(encoding="utf-8-sig", newline="") as source:
            rows = list(csv.reader(source))

        account_number = self._account_number(path, rows)
        try:
            account_column = config.rbc_accounts[account_number]
        except KeyError as exc:
            raise ValueError(
                f"{path}: RBC account {account_number!r} is missing from inputs/config.json"
            ) from exc

        holdings = self._cash_holdings(path, rows, config, account_column)
        holdings.extend(self._security_holdings(path, rows, config, account_column))
        return holdings

    def _cash_holdings(
        self,
        path: Path,
        rows: list[list[str]],
        config: PortfolioConfig,
        account_column: str,
    ) -> list[Holding]:
        header_index = next(
            (index for index, row in enumerate(rows) if row and row[0] == "Currency"),
            None,
        )
        if header_index is None:
            return []
        header = rows[header_index]
        try:
            currency_index = header.index("Currency")
            cash_index = header.index("Cash")
        except ValueError as exc:
            raise ValueError(f"{path}: RBC cash summary columns are incomplete") from exc

        holdings = []
        for row_number, row in enumerate(rows[header_index + 1:], start=header_index + 2):
            if len(row) <= max(currency_index, cash_index):
                break
            currency = row[currency_index].strip().upper()
            if not currency:
                break
            if currency not in config.allowed_currencies:
                raise ValueError(
                    f"{path}:{row_number}: unsupported currency {currency!r}; "
                    f"expected one of {sorted(config.allowed_currencies)}"
                )
            cash = row[cash_index].strip()
            if cash and cash.upper() != "N/A":
                holdings.append(Holding(
                    symbol=f"CASH-{currency}",
                    currency=currency,
                    account_column=account_column,
                    market_value=self._decimal(path, f"row {row_number} cash", cash),
                ))
        return holdings

    def _security_holdings(
        self,
        path: Path,
        rows: list[list[str]],
        config: PortfolioConfig,
        account_column: str,
    ) -> list[Holding]:
        header_index = next(
            (
                index for index, row in enumerate(rows)
                if row[:len(self.HOLDINGS_HEADER_PREFIX)] == self.HOLDINGS_HEADER_PREFIX
            ),
            None,
        )
        if header_index is None:
            raise ValueError(f"{path}: RBC holdings header was not found")
        header = rows[header_index]
        try:
            symbol_index = header.index("Symbol")
            currency_index = header.index("Currency")
            value_index = header.index("Total Market Value")
        except ValueError as exc:
            raise ValueError(f"{path}: RBC holdings columns are incomplete") from exc

        holdings = []
        for row_number, row in enumerate(rows[header_index + 1:], start=header_index + 2):
            if len(row) <= symbol_index or not row[symbol_index].strip():
                continue
            if len(row) <= max(currency_index, value_index):
                raise ValueError(f"{path}:{row_number}: RBC holding columns are missing")
            symbol = row[symbol_index].strip()
            currency = row[currency_index].strip().upper()
            if currency not in config.allowed_currencies:
                raise ValueError(
                    f"{path}:{row_number}: unsupported currency {currency!r}; "
                    f"expected one of {sorted(config.allowed_currencies)}"
                )
            holdings.append(Holding(
                symbol=symbol,
                currency=currency,
                account_column=account_column,
                market_value=self._decimal(
                    path, f"row {row_number} total market value", row[value_index]
                ),
            ))
        return holdings

    def _account_number(self, path: Path, rows: list[list[str]]) -> str:
        for row in rows[:10]:
            if row:
                match = self.ACCOUNT_PATTERN.search(row[0])
                if match:
                    return match.group(1)
        raise ValueError(f"{path}: RBC account number was not found")

    @staticmethod
    def _decimal(path: Path, label: str, raw_value: str) -> Decimal:
        normalized = raw_value.strip().replace(",", "")
        try:
            return Decimal(normalized)
        except InvalidOperation as exc:
            raise ValueError(f"{path}: invalid {label}: {raw_value!r}") from exc
