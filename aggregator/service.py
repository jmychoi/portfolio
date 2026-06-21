from collections import defaultdict
from collections.abc import Mapping
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

from aggregator.atomic_csv import write_atomic_csv
from aggregator.config import CASH_METADATA, AssetMetadata, PortfolioConfig
from aggregator.models import Holding
from aggregator.parsers import PARSERS


OUTPUT_PRECISION = Decimal("0.01")


def output_columns(account_columns: tuple[str, ...]) -> tuple[str, ...]:
    return (
        "Asset", "Type", "Market", "Sector", "Risk", "Currency", "FX Rate CAD", "Yield",
        "Total", "Total CAD", "% Holding", "Projected Annual Income", "URL",
        *account_columns,
    )


def discover_csv_files(portfolio_directory: Path) -> list[Path]:
    if not portfolio_directory.is_dir():
        raise ValueError(f"Portfolio directory does not exist: {portfolio_directory}")
    inputs_directory = portfolio_directory / "inputs"
    if not inputs_directory.is_dir():
        raise ValueError(f"Inputs directory does not exist: {inputs_directory}")
    files = sorted(inputs_directory.glob("*.csv"))
    if not files:
        raise ValueError(f"No holdings CSV files were found in {inputs_directory}")
    return files


def parse_files(paths: list[Path], config: PortfolioConfig) -> list[Holding]:
    holdings = []
    for path in paths:
        matching = [parser for parser in PARSERS if parser.can_parse(path)]
        if len(matching) != 1:
            raise ValueError(
                f"{path}: expected exactly one matching parser, found {len(matching)}"
            )
        holdings.extend(matching[0].parse(path, config))
    return holdings


def aggregate(
    holdings: list[Holding],
    exchange_rates_to_cad: dict[str, Decimal],
    config: PortfolioConfig,
    market_yields: dict[str, Decimal | None] | None = None,
    market_urls: dict[str, str | None] | None = None,
) -> list[dict[str, str]]:
    by_symbol: dict[str, dict[str, Decimal]] = defaultdict(
        lambda: {column: Decimal("0") for column in config.account_columns}
    )
    metadata_by_symbol = {
        symbol: _configured_metadata(symbol, symbol.removeprefix("CASH-"), CASH_METADATA)
        for symbol in ("CASH-CAD", "CASH-USD")
    }
    manual_yields: dict[str, Decimal | None] = {}
    manual_urls: dict[str, str | None] = {}
    market_yields = market_yields or {}
    market_urls = market_urls or {}

    # Required even when no input contributes cash.
    by_symbol["CASH-CAD"]
    by_symbol["CASH-USD"]

    for holding in holdings:
        if holding.account_column not in config.account_columns:
            raise ValueError(f"Unknown account column: {holding.account_column}")
        metadata = _holding_metadata(holding, config.assets)
        previous_metadata = metadata_by_symbol.setdefault(holding.symbol, metadata)
        if previous_metadata != metadata:
            raise ValueError(f"Asset {holding.symbol!r} has inconsistent metadata")
        if holding.asset_type == "Real Estate":
            if (
                holding.symbol in manual_yields
                and manual_yields[holding.symbol] != holding.yield_percent
            ):
                raise ValueError(f"Asset {holding.symbol!r} has inconsistent yields")
            manual_yields[holding.symbol] = holding.yield_percent
            if holding.symbol in manual_urls and manual_urls[holding.symbol] != holding.url:
                raise ValueError(f"Asset {holding.symbol!r} has inconsistent URLs")
            manual_urls[holding.symbol] = holding.url
        by_symbol[holding.symbol][holding.account_column] += holding.market_value

    total_cad_by_symbol = {}
    for symbol, accounts in by_symbol.items():
        currency = metadata_by_symbol[symbol][4]
        try:
            rate = exchange_rates_to_cad[currency]
        except KeyError as exc:
            raise ValueError(f"No CAD exchange rate found in fx.csv for {currency}") from exc
        total_cad_by_symbol[symbol] = sum(accounts.values(), Decimal("0")) * rate
    portfolio_total_cad = sum(total_cad_by_symbol.values(), Decimal("0"))

    rows_with_percentages = []
    for symbol, accounts in by_symbol.items():
        total = sum(accounts.values(), Decimal("0"))
        total_cad = total_cad_by_symbol[symbol]
        percentage = (
            total_cad / portfolio_total_cad * Decimal("100")
            if portfolio_total_cad else Decimal("0")
        )
        asset_type, market, sector, risk, currency = metadata_by_symbol[symbol]
        if asset_type == "Cash":
            yield_percent = Decimal("0")
            url = None
        elif asset_type == "Real Estate":
            yield_percent = manual_yields.get(symbol)
            url = manual_urls.get(symbol)
        else:
            yield_percent = market_yields.get(symbol)
            url = market_urls.get(symbol)
        row = {
            "Asset": symbol,
            "Type": asset_type,
            "Market": market,
            "Sector": sector,
            "Risk": risk,
            "Yield": _optional_decimal_text(yield_percent),
            "Currency": currency,
            "FX Rate CAD": _rate_text(exchange_rates_to_cad[currency]),
        }
        row.update({column: _decimal_text(accounts[column]) for column in config.account_columns})
        row["Total"] = _decimal_text(total)
        row["Total CAD"] = _decimal_text(total_cad)
        row["% Holding"] = _decimal_text(percentage)
        projected_income = (
            total_cad * yield_percent / Decimal("100")
            if yield_percent is not None else None
        )
        row["Projected Annual Income"] = _optional_decimal_text(projected_income)
        row["URL"] = url or ""
        rows_with_percentages.append((row, percentage))

    rows_with_percentages.sort(
        key=lambda item: (-item[1], item[0]["Asset"])
    )
    return [row for row, _ in rows_with_percentages]


def write_csv(
    rows: list[dict[str, str]], output_path: Path, account_columns: tuple[str, ...]
) -> None:
    write_atomic_csv(output_path, output_columns(account_columns), rows)


def _decimal_text(value: Decimal) -> str:
    return format(value.quantize(OUTPUT_PRECISION, rounding=ROUND_HALF_UP), ".2f")


def _optional_decimal_text(value: Decimal | None) -> str:
    return "" if value is None else _decimal_text(value)


def _rate_text(value: Decimal) -> str:
    return format(value.normalize(), "f")


def _configured_metadata(
    symbol: str, currency: str, asset_metadata: Mapping[str, AssetMetadata]
) -> tuple[str, str, str, str, str]:
    try:
        metadata = asset_metadata[symbol]
        return metadata.asset_type, metadata.market, metadata.sector, metadata.risk, currency
    except KeyError as exc:
        raise ValueError(
            f"Asset {symbol!r} is missing deterministic classification mappings"
        ) from exc


def _holding_metadata(
    holding: Holding, asset_metadata: Mapping[str, AssetMetadata]
) -> tuple[str, str, str, str, str]:
    if holding.symbol in CASH_METADATA:
        return _configured_metadata(holding.symbol, holding.currency, CASH_METADATA)
    supplied = (holding.asset_type, holding.market, holding.sector, holding.risk)
    if any(value is not None for value in supplied):
        if not all(value is not None for value in supplied):
            raise ValueError(f"Asset {holding.symbol!r} has incomplete input metadata")
        return (
            holding.asset_type, holding.market, holding.sector, holding.risk,
            holding.currency,
        )

    return _configured_metadata(holding.symbol, holding.currency, asset_metadata)
