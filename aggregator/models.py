from dataclasses import dataclass
from decimal import Decimal


@dataclass(frozen=True)
class Holding:
    symbol: str
    currency: str
    account_column: str
    market_value: Decimal
    asset_type: str | None = None
    market: str | None = None
    sector: str | None = None
    risk: str | None = None
    yield_percent: Decimal | None = None
    url: str | None = None
