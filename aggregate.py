import argparse
from datetime import datetime
from pathlib import Path

from aggregator.config import load_portfolio_config, load_portfolio_config_document
from aggregator.exchange_rates import ensure_fx_file, load_fx_file
from aggregator.service import (
    build_portfolio_document,
    discover_csv_files,
    parse_files,
    write_portfolio_json,
)
from aggregator.yields import ensure_yields_file, load_yields_file, market_assets


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Aggregate Wealthsimple, TD Direct Investing, and real-estate CSV holdings."
    )
    parser.add_argument(
        "portfolio_directory", type=Path,
        help="directory containing inputs, cache, and generated portfolio.json",
    )
    parser.add_argument(
        "--output", "-o", default="portfolio.json",
        help="output filename within the portfolio directory (default: portfolio.json)",
    )
    parser.add_argument(
        "--date",
        type=_iso_date,
        default=datetime.now().astimezone().date().isoformat(),
        help="portfolio date in YYYY-MM-DD format (default: current local date)",
    )
    return parser


def _iso_date(value: str) -> str:
    try:
        parsed = datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError as exc:
        raise argparse.ArgumentTypeError("date must use valid YYYY-MM-DD format") from exc
    if parsed.isoformat() != value:
        raise argparse.ArgumentTypeError("date must use valid YYYY-MM-DD format")
    return value


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    portfolio_directory = args.portfolio_directory
    if not portfolio_directory.is_dir():
        parser.error(f"portfolio directory does not exist: {portfolio_directory}")
    output_name = Path(args.output)
    if output_name.is_absolute() or output_name.name != args.output:
        parser.error("--output must be a filename within the portfolio directory")
    if output_name.suffix.lower() != ".json":
        parser.error("--output must use the .json extension")

    output_path = portfolio_directory / output_name
    portfolio_config = load_portfolio_config(portfolio_directory)
    configuration = load_portfolio_config_document(portfolio_directory)
    fx_path = ensure_fx_file(portfolio_directory)
    fx_records = load_fx_file(fx_path)
    paths = discover_csv_files(portfolio_directory)
    holdings = parse_files(paths, portfolio_config)
    yield_path = ensure_yields_file(
        portfolio_directory, market_assets(holdings, portfolio_config.assets)
    )
    yield_records = load_yields_file(yield_path)
    document = build_portfolio_document(
        holdings, fx_records, portfolio_config, configuration, yield_records,
        snapshot_date=args.date,
    )
    write_portfolio_json(document, output_path)

    usd = fx_records["USD"]
    provenance = f" from {usd.observation_date}" if usd.observation_date else ""
    if usd.source:
        provenance += f" ({usd.source})"
    print(f"Using USD/CAD rate {usd.rate_to_cad}{provenance}")
    unavailable = sorted(
        asset for asset, record in yield_records.items()
        if record.yield_percent is None
    )
    if unavailable:
        print(f"Yield unavailable for: {', '.join(unavailable)}")
    print(f"Wrote {len(document['holdings'])} holdings to {output_path}")


if __name__ == "__main__":
    main()
