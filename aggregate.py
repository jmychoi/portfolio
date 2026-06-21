import argparse
from pathlib import Path

from aggregator.asset_urls import yahoo_finance_url
from aggregator.config import load_portfolio_config
from aggregator.exchange_rates import ensure_fx_file, load_fx_file
from aggregator.service import aggregate, discover_csv_files, parse_files, write_csv
from aggregator.yields import ensure_yields_file, load_yields_file, market_assets


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Aggregate Wealthsimple, TD Direct Investing, and real-estate CSV holdings."
    )
    parser.add_argument(
        "portfolio_directory", type=Path,
        help="directory containing source CSVs, fx.csv, and generated portfolio.csv",
    )
    parser.add_argument(
        "--output", "-o", default="portfolio.csv",
        help="output filename within the portfolio directory (default: portfolio.csv)",
    )
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    portfolio_directory = args.portfolio_directory
    if not portfolio_directory.is_dir():
        parser.error(f"portfolio directory does not exist: {portfolio_directory}")
    output_name = Path(args.output)
    if output_name.is_absolute() or output_name.name != args.output:
        parser.error("--output must be a filename within the portfolio directory")
    if output_name.name.lower() in {"fx.csv", "yields.csv"}:
        parser.error("--output cannot overwrite a managed data file")

    output_path = portfolio_directory / output_name
    portfolio_config = load_portfolio_config(portfolio_directory)
    fx_path = ensure_fx_file(portfolio_directory)
    fx_records = load_fx_file(fx_path)
    exchange_rates = {
        currency: record.rate_to_cad for currency, record in fx_records.items()
    }
    paths = discover_csv_files(portfolio_directory)
    holdings = parse_files(paths, portfolio_config)
    yield_path = ensure_yields_file(
        portfolio_directory, market_assets(holdings, portfolio_config.assets)
    )
    yield_records = load_yields_file(yield_path)
    market_yields = {
        asset: record.yield_percent for asset, record in yield_records.items()
    }
    market_urls = {
        asset: yahoo_finance_url(record.provider_symbol)
        for asset, record in yield_records.items()
    }
    rows = aggregate(
        holdings, exchange_rates, portfolio_config, market_yields, market_urls
    )
    write_csv(rows, output_path, portfolio_config.account_columns)

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
    print(f"Wrote {len(rows)} holdings to {output_path}")


if __name__ == "__main__":
    main()
