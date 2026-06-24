import csv
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation
from pathlib import Path

from aggregator.atomic_csv import write_atomic_csv
from collections.abc import Mapping

from aggregator.config import AssetMetadata
from aggregator.models import Holding


YIELD_COLUMNS = ("Asset", "Provider Symbol", "Yield", "As Of", "Source", "Status")
CACHE_RELATIVE_PATH = Path("cache") / "yields.csv"


@dataclass(frozen=True)
class YieldRecord:
    asset: str
    provider_symbol: str
    yield_percent: Decimal | None
    as_of: str
    source: str
    status: str


def market_assets(
    holdings: list[Holding], asset_metadata: Mapping[str, AssetMetadata]
) -> dict[str, str]:
    assets = {}
    for holding in holdings:
        metadata = asset_metadata.get(holding.symbol)
        asset_type = holding.asset_type or (metadata.asset_type if metadata else None)
        if asset_type not in {"Stock", "ETF"}:
            continue
        provider_symbol = yfinance_symbol(holding.symbol, holding.currency)
        previous = assets.setdefault(holding.symbol, provider_symbol)
        if previous != provider_symbol:
            raise ValueError(
                f"Asset {holding.symbol!r} maps to multiple yfinance symbols"
            )
    return assets


def yfinance_symbol(asset: str, currency: str) -> str:
    if asset.endswith(".U"):
        return f"{asset[:-2]}-U.TO"
    if currency == "CAD":
        return f"{asset}.TO"
    return asset


def ensure_yields_file(portfolio_directory: Path, assets: dict[str, str], fetcher=None) -> Path:
    path = portfolio_directory / CACHE_RELATIVE_PATH
    records = load_yields_file(path) if path.exists() else {}
    missing = {asset: symbol for asset, symbol in assets.items() if asset not in records}
    for asset, record in records.items():
        if asset in assets and record.status.lower() == "refresh":
            missing[asset] = record.provider_symbol or assets[asset]
    if missing:
        fetched = (fetcher or fetch_yfinance_yields)(missing)
        if set(fetched) != set(missing):
            raise RuntimeError("Yield provider did not return a result for every requested asset")
        records.update(fetched)
        write_yields_file(path, records)
    elif not path.exists():
        write_yields_file(path, records)
    return path


def fetch_yfinance_yields(assets: dict[str, str]) -> dict[str, YieldRecord]:
    try:
        import yfinance as yf
    except ImportError as exc:
        raise RuntimeError(
            "yfinance is required for yield lookup; install aggregator/requirements.txt"
        ) from exc

    provider_symbols = sorted(set(assets.values()))
    try:
        history = yf.download(
            provider_symbols,
            period="1y",
            actions=True,
            auto_adjust=False,
            progress=False,
            threads=True,
            multi_level_index=True,
        )
    except Exception as exc:
        raise RuntimeError(f"Unable to download yield data from yfinance: {exc}") from exc

    records = {}
    for asset, provider_symbol in assets.items():
        try:
            closes = history["Close"][provider_symbol].dropna()
        except (KeyError, TypeError):
            closes = ()
        if len(closes) == 0:
            records[asset] = YieldRecord(
                asset, provider_symbol, None, "", "yfinance", "unavailable"
            )
            continue

        try:
            dividends = history["Dividends"][provider_symbol].dropna()
            dividends = dividends[dividends > 0]
            distribution_values = [Decimal(str(value)) for value in dividends.tolist()]
        except (KeyError, TypeError):
            distribution_values = []
        latest_price = Decimal(str(closes.iloc[-1]))
        yield_percent = annualized_latest_yield(latest_price, distribution_values)
        as_of = closes.index[-1].date().isoformat()
        records[asset] = YieldRecord(
            asset, provider_symbol, yield_percent, as_of, "yfinance", "ok"
        )
    return records


def annualized_latest_yield(
    latest_price: Decimal, distributions: list[Decimal]
) -> Decimal:
    if latest_price <= 0:
        raise ValueError("Latest market price must be positive")
    if not distributions:
        return Decimal("0")
    return distributions[-1] * len(distributions) / latest_price * Decimal("100")


def load_yields_file(path: Path) -> dict[str, YieldRecord]:
    try:
        source = path.open(encoding="utf-8-sig", newline="")
    except OSError as exc:
        raise ValueError(f"Unable to read yield file {path}: {exc}") from exc
    with source:
        reader = csv.DictReader(source)
        if reader.fieldnames is None or not set(YIELD_COLUMNS).issubset(reader.fieldnames):
            raise ValueError(f"{path}: expected columns {', '.join(YIELD_COLUMNS)}")
        records = {}
        for row_number, row in enumerate(reader, start=2):
            asset = (row.get("Asset") or "").strip()
            if not asset:
                raise ValueError(f"{path}:{row_number}: asset is required")
            if asset in records:
                raise ValueError(f"{path}:{row_number}: duplicate asset {asset}")
            raw_yield = (row.get("Yield") or "").strip()
            try:
                yield_percent = Decimal(raw_yield) if raw_yield else None
            except InvalidOperation as exc:
                raise ValueError(f"{path}:{row_number}: invalid yield") from exc
            if yield_percent is not None and yield_percent < 0:
                raise ValueError(f"{path}:{row_number}: yield cannot be negative")
            as_of = (row.get("As Of") or "").strip()
            if as_of:
                try:
                    date.fromisoformat(as_of)
                except ValueError as exc:
                    raise ValueError(f"{path}:{row_number}: invalid As Of date") from exc
            records[asset] = YieldRecord(
                asset=asset,
                provider_symbol=(row.get("Provider Symbol") or "").strip(),
                yield_percent=yield_percent,
                as_of=as_of,
                source=(row.get("Source") or "").strip(),
                status=(row.get("Status") or "").strip(),
            )
    return records


def write_yields_file(path: Path, records: dict[str, YieldRecord]) -> None:
    write_atomic_csv(path, YIELD_COLUMNS, (
        {
            "Asset": records[asset].asset,
            "Provider Symbol": records[asset].provider_symbol,
            "Yield": _decimal_text(records[asset].yield_percent),
            "As Of": records[asset].as_of,
            "Source": records[asset].source,
            "Status": records[asset].status,
        }
        for asset in sorted(records)
    ))


def _decimal_text(value: Decimal | None) -> str:
    if value is None:
        return ""
    return format(value.normalize(), "f")
