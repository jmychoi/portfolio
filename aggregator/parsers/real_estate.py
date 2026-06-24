import csv
from decimal import Decimal, InvalidOperation
from pathlib import Path

from aggregator.asset_urls import validate_asset_url
from aggregator.config import PortfolioConfig
from aggregator.models import Holding
from aggregator.parsers.base import InputParser


class RealEstateParser(InputParser):
    REQUIRED_COLUMNS = {
        "Name", "Market", "Risk", "Currency", "Value", "Net Monthly Income", "URL"
    }

    def can_parse(self, path: Path) -> bool:
        with path.open(encoding="utf-8-sig", newline="") as source:
            header = next(csv.reader(source), [])
        return self.REQUIRED_COLUMNS.issubset(header)

    def parse(self, path: Path, config: PortfolioConfig) -> list[Holding]:
        holdings = []
        with path.open(encoding="utf-8-sig", newline="") as source:
            for row_number, row in enumerate(csv.DictReader(source), start=2):
                symbol = (row.get("Name") or "").strip()
                if not symbol:
                    raise ValueError(f"{path}:{row_number}: real-estate name is required")
                market = (row.get("Market") or "").strip()
                if market not in config.allowed_markets:
                    raise ValueError(
                        f"{path}:{row_number}: invalid Market {market!r}; "
                        f"expected one of {sorted(config.allowed_markets)}"
                    )
                risk = (row.get("Risk") or "").strip().title()
                if risk not in config.allowed_risks:
                    raise ValueError(
                        f"{path}:{row_number}: invalid Risk {risk!r}; "
                        f"expected one of {sorted(config.allowed_risks)}"
                    )
                currency = (row.get("Currency") or "").strip().upper()
                if currency not in config.allowed_currencies:
                    raise ValueError(
                        f"{path}:{row_number}: unsupported currency {currency!r}; "
                        f"expected one of {sorted(config.allowed_currencies)}"
                    )
                try:
                    value = Decimal(row["Value"].strip())
                except (InvalidOperation, AttributeError) as exc:
                    raise ValueError(f"{path}:{row_number}: invalid value") from exc
                if value <= 0:
                    raise ValueError(f"{path}:{row_number}: value must be positive")
                try:
                    net_monthly_income = Decimal(row["Net Monthly Income"].strip())
                except (InvalidOperation, AttributeError) as exc:
                    raise ValueError(
                        f"{path}:{row_number}: invalid net monthly income"
                    ) from exc
                yield_percent = (
                    net_monthly_income * Decimal("12") / value * Decimal("100")
                )
                url = validate_asset_url(
                    row.get("URL") or "", f"{path}:{row_number}"
                )
                holdings.append(Holding(
                    symbol=symbol,
                    currency=currency,
                    account_column=config.real_estate_account,
                    market_value=value,
                    asset_type="Real Estate",
                    market=market,
                    sector="Real Estate",
                    risk=risk,
                    yield_percent=yield_percent,
                    url=url,
                ))
        return holdings
