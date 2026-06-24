from collections import defaultdict
from collections.abc import Mapping
from datetime import date
from decimal import Decimal
from pathlib import Path

from aggregator.atomic_json import write_atomic_json
from aggregator.config import CASH_METADATA, AssetMetadata, PortfolioConfig
from aggregator.models import Holding
from aggregator.parsers import PARSERS


SCHEMA_VERSION = 3


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


def build_portfolio_document(
    holdings: list[Holding],
    exchange_rates: Mapping[str, object],
    config: PortfolioConfig,
    configuration: dict,
    yield_records: Mapping[str, object],
    snapshot_date: str,
) -> dict:
    _validate_snapshot_date(snapshot_date)
    by_symbol: dict[str, dict[str, Decimal]] = defaultdict(
        lambda: {column: Decimal("0") for column in config.account_columns}
    )
    metadata_by_symbol = {
        symbol: CASH_METADATA[symbol] for symbol in ("CASH-CAD", "CASH-USD")
    }
    real_estate_yields: dict[str, Decimal | None] = {}
    real_estate_urls: dict[str, str | None] = {}

    by_symbol["CASH-CAD"]
    by_symbol["CASH-USD"]

    for holding in holdings:
        if holding.account_column not in config.account_columns:
            raise ValueError(f"Unknown account column: {holding.account_column}")
        metadata = _holding_metadata(holding, config.assets)
        previous_metadata = metadata_by_symbol.setdefault(holding.symbol, metadata)
        if previous_metadata != metadata:
            raise ValueError(f"Asset {holding.symbol!r} has inconsistent metadata")
        if metadata.currency != holding.currency:
            raise ValueError(
                f"Asset {holding.symbol!r}: configured currency {metadata.currency} "
                f"conflicts with reported currency {holding.currency}"
            )
        if holding.asset_type == "Real Estate":
            if holding.symbol in real_estate_yields and real_estate_yields[holding.symbol] != holding.yield_percent:
                raise ValueError(f"Asset {holding.symbol!r} has inconsistent yields")
            if holding.symbol in real_estate_urls and real_estate_urls[holding.symbol] != holding.url:
                raise ValueError(f"Asset {holding.symbol!r} has inconsistent URLs")
            real_estate_yields[holding.symbol] = holding.yield_percent
            real_estate_urls[holding.symbol] = holding.url
        by_symbol[holding.symbol][holding.account_column] += holding.market_value

    for symbol, metadata in metadata_by_symbol.items():
        currency = metadata.currency
        if currency not in exchange_rates:
            raise ValueError(f"No CAD exchange rate found in fx.csv for {currency}")

    supplemental_assets = {
        symbol: _metadata_document(metadata)
        for symbol, metadata in CASH_METADATA.items()
    }
    for symbol, metadata in metadata_by_symbol.items():
        if metadata.asset_type == "Real Estate":
            record = _metadata_document(metadata)
            if real_estate_urls.get(symbol):
                record["url"] = real_estate_urls[symbol]
            supplemental_assets[symbol] = record

    yields = {
        asset: {
            "providerSymbol": record.provider_symbol or None,
            "percent": record.yield_percent,
            "asOf": record.as_of or None,
            "source": record.source or None,
            "status": record.status or None,
        }
        for asset, record in sorted(yield_records.items())
    }
    for symbol in CASH_METADATA:
        yields[symbol] = {
            "providerSymbol": None,
            "percent": Decimal("0"),
            "asOf": None,
            "source": "built-in",
            "status": "fixed",
        }
    for symbol, yield_percent in real_estate_yields.items():
        yields[symbol] = {
            "providerSymbol": None,
            "percent": yield_percent,
            "asOf": None,
            "source": "real-estate",
            "status": "derived",
        }

    return {
        "schemaVersion": SCHEMA_VERSION,
        "date": snapshot_date,
        "configuration": configuration,
        "exchangeRates": {
            currency: {
                "rateToCad": record.rate_to_cad,
                "date": record.observation_date or None,
                "source": record.source or None,
            }
            for currency, record in sorted(exchange_rates.items())
        },
        "yields": yields,
        "supplementalAssets": supplemental_assets,
        "holdings": [
            {
                "asset": symbol,
                "accounts": {
                    account: value
                    for account, value in by_symbol[symbol].items()
                    if value != 0
                },
            }
            for symbol in sorted(by_symbol)
        ],
    }


def write_portfolio_json(document: dict, output_path: Path) -> None:
    write_atomic_json(output_path, document)


def _validate_snapshot_date(value: str) -> None:
    if not isinstance(value, str) or len(value) != 10:
        raise ValueError("Portfolio date must use valid YYYY-MM-DD format")
    try:
        parsed = date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError("Portfolio date must use valid YYYY-MM-DD format") from exc
    if parsed.isoformat() != value:
        raise ValueError("Portfolio date must use valid YYYY-MM-DD format")


def _metadata_document(metadata: AssetMetadata) -> dict[str, str]:
    return {
        "type": metadata.asset_type,
        "market": metadata.market,
        "sector": metadata.sector,
        "risk": metadata.risk,
        "currency": metadata.currency,
    }


def _holding_metadata(
    holding: Holding, asset_metadata: Mapping[str, AssetMetadata]
) -> AssetMetadata:
    if holding.symbol in CASH_METADATA:
        return CASH_METADATA[holding.symbol]
    supplied = (holding.asset_type, holding.market, holding.sector, holding.risk)
    if any(value is not None for value in supplied):
        if not all(value is not None for value in supplied):
            raise ValueError(f"Asset {holding.symbol!r} has incomplete input metadata")
        return AssetMetadata(
            holding.asset_type, holding.market, holding.sector, holding.risk,
            holding.currency,
        )
    try:
        return asset_metadata[holding.symbol]
    except KeyError as exc:
        raise ValueError(
            f"Asset {holding.symbol!r} is missing deterministic classification mappings"
        ) from exc
