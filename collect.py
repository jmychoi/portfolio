import argparse
import json
from datetime import date
from pathlib import Path

from aggregator.atomic_json import write_atomic_json_compact


COLLECTION_SCHEMA_VERSION = 1
COLLECTION_KIND = "portfolioCollection"
PORTFOLIO_SCHEMA_VERSION = 3


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Collect dated portfolio JSON snapshots into portfolios.json."
    )
    parser.add_argument(
        "portfolio_directory",
        type=Path,
        help="directory containing portfolio JSON snapshots",
    )
    parser.add_argument(
        "--output", "-o", default="portfolios.json",
        help="output filename within the portfolio directory (default: portfolios.json)",
    )
    return parser


def load_portfolios(directory: Path, output_path: Path) -> list[dict]:
    if not directory.is_dir():
        raise ValueError(f"Portfolio directory does not exist: {directory}")
    paths = sorted(
        path for path in directory.glob("*.json")
        if path.resolve() != output_path.resolve()
    )
    if not paths:
        raise ValueError(f"No portfolio JSON files were found in {directory}")

    by_date = {}
    for path in paths:
        document = _load_json(path)
        portfolio_date = _validate_portfolio(document, path)
        if portfolio_date in by_date:
            raise ValueError(
                f"Duplicate portfolio date {portfolio_date}: "
                f"{by_date[portfolio_date][0].name} and {path.name}"
            )
        by_date[portfolio_date] = (path, document)
    return [by_date[key][1] for key in sorted(by_date)]


def build_collection_document(portfolios: list[dict]) -> dict:
    if not portfolios:
        raise ValueError("At least one portfolio is required")
    return {
        "schemaVersion": COLLECTION_SCHEMA_VERSION,
        "kind": COLLECTION_KIND,
        "portfolios": portfolios,
    }


def _load_json(path: Path) -> dict:
    try:
        with path.open(encoding="utf-8-sig") as source:
            document = json.load(source, object_pairs_hook=_unique_object)
    except OSError as exc:
        raise ValueError(f"Unable to read {path}: {exc}") from exc
    except (json.JSONDecodeError, ValueError) as exc:
        raise ValueError(f"Invalid portfolio JSON {path}: {exc}") from exc
    if not isinstance(document, dict):
        raise ValueError(f"{path}: top-level value must be an object")
    return document


def _validate_portfolio(document: dict, path: Path) -> str:
    if document.get("schemaVersion") != PORTFOLIO_SCHEMA_VERSION:
        raise ValueError(
            f"{path}: expected portfolio schema version {PORTFOLIO_SCHEMA_VERSION}"
        )
    portfolio_date = document.get("date")
    if not isinstance(portfolio_date, str) or len(portfolio_date) != 10:
        raise ValueError(f"{path}: date must use valid YYYY-MM-DD format")
    try:
        parsed_date = date.fromisoformat(portfolio_date)
    except ValueError as exc:
        raise ValueError(f"{path}: date must use valid YYYY-MM-DD format") from exc
    if parsed_date.isoformat() != portfolio_date:
        raise ValueError(f"{path}: date must use valid YYYY-MM-DD format")

    configuration = _object(document.get("configuration"), path, "configuration")
    accounts = _string_array(configuration.get("account_columns"), path, "account_columns")
    allowed_currencies = set(
        _string_array(configuration.get("allowed_currencies"), path, "allowed_currencies")
    )
    configured = _object(configuration.get("assets"), path, "configuration.assets")
    supplemental = _object(document.get("supplementalAssets"), path, "supplementalAssets")
    duplicate_assets = configured.keys() & supplemental.keys()
    if duplicate_assets:
        raise ValueError(f"{path}: duplicate asset metadata {sorted(duplicate_assets)}")
    metadata = {**configured, **supplemental}
    rates = _object(document.get("exchangeRates"), path, "exchangeRates")
    yields = _object(document.get("yields"), path, "yields")
    holdings = document.get("holdings")
    if not isinstance(holdings, list):
        raise ValueError(f"{path}: holdings must be an array")

    seen_assets = set()
    for index, holding in enumerate(holdings):
        label = f"holdings[{index}]"
        holding = _object(holding, path, label)
        asset = holding.get("asset")
        if not isinstance(asset, str) or not asset.strip():
            raise ValueError(f"{path}: {label}.asset is required")
        if asset in seen_assets:
            raise ValueError(f"{path}: duplicate holding asset {asset!r}")
        seen_assets.add(asset)
        if asset not in metadata:
            raise ValueError(f"{path}: no metadata for {asset!r}")
        asset_metadata = _object(metadata[asset], path, f"metadata for {asset}")
        currency = asset_metadata.get("currency")
        if currency not in allowed_currencies:
            raise ValueError(f"{path}: unsupported currency {currency!r} for {asset!r}")
        rate = _object(rates.get(currency), path, f"exchangeRates.{currency}").get("rateToCad")
        if not _is_number(rate) or rate <= 0:
            raise ValueError(f"{path}: invalid exchange rate for {currency}")
        values = _object(holding.get("accounts"), path, f"{label}.accounts")
        for account, value in values.items():
            if account not in accounts:
                raise ValueError(f"{path}: {label} uses unknown account {account!r}")
            if not _is_number(value) or value < 0:
                raise ValueError(f"{path}: {label}.{account} must be non-negative")
        yield_record = yields.get(asset)
        if yield_record is not None:
            yield_record = _object(yield_record, path, f"yields.{asset}")
            yield_percent = yield_record.get("percent")
            if yield_percent is not None and (
                not _is_number(yield_percent) or yield_percent < 0
            ):
                raise ValueError(f"{path}: yield for {asset!r} must be non-negative")
    return portfolio_date


def _object(value: object, path: Path, label: str) -> dict:
    if not isinstance(value, dict):
        raise ValueError(f"{path}: {label} must be an object")
    return value


def _string_array(value: object, path: Path, label: str) -> tuple[str, ...]:
    if not isinstance(value, list) or not value:
        raise ValueError(f"{path}: {label} must be a non-empty array")
    if any(not isinstance(item, str) or not item.strip() for item in value):
        raise ValueError(f"{path}: {label} values must be non-empty strings")
    result = tuple(item.strip() for item in value)
    if len(result) != len(set(result)):
        raise ValueError(f"{path}: {label} contains duplicates")
    return result


def _is_number(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _unique_object(pairs: list[tuple[str, object]]) -> dict:
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate key {key!r}")
        result[key] = value
    return result


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    directory = args.portfolio_directory
    output_name = Path(args.output)
    if output_name.is_absolute() or output_name.name != args.output:
        parser.error("--output must be a filename within the portfolio directory")
    if output_name.suffix.lower() != ".json":
        parser.error("--output must use the .json extension")
    output_path = directory / output_name
    try:
        portfolios = load_portfolios(directory, output_path)
        document = build_collection_document(portfolios)
        write_atomic_json_compact(output_path, document)
    except ValueError as exc:
        parser.error(str(exc))
    print(
        f"Wrote {len(portfolios)} portfolios from {portfolios[0]['date']} "
        f"through {portfolios[-1]['date']} to {output_path}"
    )


if __name__ == "__main__":
    main()
