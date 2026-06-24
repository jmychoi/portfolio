import csv
import json
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from aggregator.atomic_csv import write_atomic_csv


BANK_OF_CANADA_URL = (
    "https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?recent=1"
)
FX_COLUMNS = ("Currency", "Rate CAD", "Date", "Source")
CACHE_RELATIVE_PATH = Path("cache") / "fx.csv"


@dataclass(frozen=True)
class ExchangeRate:
    currency: str
    rate_to_cad: Decimal
    observation_date: str
    source: str


def ensure_fx_file(portfolio_directory: Path, fetcher=None) -> Path:
    fx_path = portfolio_directory / CACHE_RELATIVE_PATH
    if fx_path.exists():
        return fx_path
    observation = (fetcher or fetch_usd_cad_rate)()
    write_fx_file(fx_path, observation)
    return fx_path


def fetch_usd_cad_rate(timeout_seconds: int = 10) -> ExchangeRate:
    request = Request(
        BANK_OF_CANADA_URL,
        headers={"User-Agent": "portfolio-aggregator/1.0"},
    )
    try:
        with urlopen(request, timeout=timeout_seconds) as response:
            payload = json.load(response)
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"Unable to fetch Bank of Canada exchange rate: {exc}") from exc

    try:
        observation = payload["observations"][-1]
        raw_date = observation["d"]
        raw_rate = observation["FXUSDCAD"]["v"]
        date.fromisoformat(raw_date)
        rate = Decimal(raw_rate)
    except (KeyError, IndexError, TypeError, ValueError, InvalidOperation) as exc:
        raise RuntimeError("Bank of Canada returned an invalid FXUSDCAD response") from exc
    if rate <= 0:
        raise RuntimeError("Bank of Canada returned a non-positive FXUSDCAD rate")
    return ExchangeRate("USD", rate, raw_date, "Bank of Canada")


def write_fx_file(path: Path, usd_rate: ExchangeRate) -> None:
    rows = (
        ExchangeRate("CAD", Decimal("1"), "", ""),
        usd_rate,
    )
    write_atomic_csv(path, FX_COLUMNS, (
        {
            "Currency": row.currency,
            "Rate CAD": str(row.rate_to_cad),
            "Date": row.observation_date,
            "Source": row.source,
        }
        for row in rows
    ))


def load_fx_file(path: Path) -> dict[str, ExchangeRate]:
    try:
        source = path.open(encoding="utf-8-sig", newline="")
    except OSError as exc:
        raise ValueError(f"Unable to read exchange-rate file {path}: {exc}") from exc
    with source:
        reader = csv.DictReader(source)
        if reader.fieldnames is None or not set(FX_COLUMNS).issubset(reader.fieldnames):
            raise ValueError(f"{path}: expected columns {', '.join(FX_COLUMNS)}")
        rates = {}
        for row_number, row in enumerate(reader, start=2):
            currency = (row.get("Currency") or "").strip().upper()
            if not currency:
                raise ValueError(f"{path}:{row_number}: currency is required")
            if currency in rates:
                raise ValueError(f"{path}:{row_number}: duplicate currency {currency}")
            try:
                rate = Decimal((row.get("Rate CAD") or "").strip())
            except InvalidOperation as exc:
                raise ValueError(f"{path}:{row_number}: invalid CAD rate") from exc
            if rate <= 0:
                raise ValueError(f"{path}:{row_number}: CAD rate must be positive")
            observation_date = (row.get("Date") or "").strip()
            if observation_date:
                try:
                    date.fromisoformat(observation_date)
                except ValueError as exc:
                    raise ValueError(
                        f"{path}:{row_number}: invalid observation date"
                    ) from exc
            rates[currency] = ExchangeRate(
                currency=currency,
                rate_to_cad=rate,
                observation_date=observation_date,
                source=(row.get("Source") or "").strip(),
            )
    if "CAD" not in rates or rates["CAD"].rate_to_cad != Decimal("1"):
        raise ValueError(f"{path}: CAD rate must be present and equal to 1")
    if "USD" not in rates:
        raise ValueError(f"{path}: USD rate is required")
    return rates
