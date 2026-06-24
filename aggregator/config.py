import json
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType
from typing import Mapping


CONFIG_RELATIVE_PATH = Path("inputs") / "config.json"


@dataclass(frozen=True)
class AssetMetadata:
    asset_type: str
    market: str
    sector: str
    risk: str


@dataclass(frozen=True)
class TddiAccount:
    account_column: str
    currency: str


@dataclass(frozen=True)
class PortfolioConfig:
    account_columns: tuple[str, ...]
    real_estate_account: str
    allowed_asset_types: frozenset[str]
    allowed_markets: frozenset[str]
    allowed_risks: frozenset[str]
    wealthsimple_account_types: Mapping[str, str]
    tddi_accounts: Mapping[str, TddiAccount]
    assets: Mapping[str, AssetMetadata]


CASH_METADATA = {
    "CASH-CAD": AssetMetadata("Cash", "Canada", "Cash", "Low"),
    "CASH-USD": AssetMetadata("Cash", "US", "Cash", "Low"),
}


def load_portfolio_config_document(portfolio_directory: Path) -> dict:
    path = portfolio_directory / CONFIG_RELATIVE_PATH
    if not path.is_file():
        raise ValueError(f"Portfolio configuration does not exist: {path}")
    try:
        with path.open(encoding="utf-8-sig") as source:
            raw = json.load(source, object_pairs_hook=_unique_object)
    except OSError as exc:
        raise ValueError(f"Unable to read portfolio configuration {path}: {exc}") from exc
    except (json.JSONDecodeError, ValueError) as exc:
        raise ValueError(f"Invalid portfolio configuration {path}: {exc}") from exc

    if not isinstance(raw, dict):
        raise ValueError(f"{path}: top-level value must be an object")
    return raw


def load_portfolio_config(portfolio_directory: Path) -> PortfolioConfig:
    path = portfolio_directory / CONFIG_RELATIVE_PATH
    raw = load_portfolio_config_document(portfolio_directory)
    expected = {
        "account_columns",
        "real_estate_account",
        "allowed_asset_types",
        "allowed_markets",
        "allowed_risks",
        "wealthsimple_account_types",
        "td_direct_investing_accounts",
        "assets",
    }
    _require_exact_keys(str(path), raw, expected)

    account_columns = _string_list(path, raw, "account_columns")
    real_estate_account = _required_string(str(path), raw, "real_estate_account")
    if real_estate_account not in account_columns:
        raise ValueError(
            f"{path}: real_estate_account must name a configured account column"
        )
    allowed_asset_types = frozenset(_string_list(path, raw, "allowed_asset_types"))
    allowed_markets = frozenset(_string_list(path, raw, "allowed_markets"))
    allowed_risks = frozenset(_string_list(path, raw, "allowed_risks"))
    _validate_cash_metadata(path, allowed_markets, allowed_risks)

    wealthsimple_accounts = _load_wealthsimple_accounts(
        path, raw["wealthsimple_account_types"], account_columns
    )
    tddi_accounts = _load_tddi_accounts(
        path, raw["td_direct_investing_accounts"], account_columns
    )
    assets = _load_assets(
        path,
        raw["assets"],
        allowed_asset_types,
        allowed_markets,
        allowed_risks,
    )
    return PortfolioConfig(
        account_columns=account_columns,
        real_estate_account=real_estate_account,
        allowed_asset_types=allowed_asset_types,
        allowed_markets=allowed_markets,
        allowed_risks=allowed_risks,
        wealthsimple_account_types=MappingProxyType(wealthsimple_accounts),
        tddi_accounts=MappingProxyType(tddi_accounts),
        assets=MappingProxyType(assets),
    )


def _load_wealthsimple_accounts(
    path: Path, raw: object, account_columns: tuple[str, ...]
) -> dict[str, str]:
    if not isinstance(raw, dict):
        raise ValueError(f"{path}: wealthsimple_account_types must be an object")
    mappings = {}
    for account_type, account_column in raw.items():
        label = f"{path}: Wealthsimple account type {account_type!r}"
        if not account_type.strip():
            raise ValueError(f"{label} must be non-empty")
        if not isinstance(account_column, str) or account_column not in account_columns:
            raise ValueError(f"{label}: unknown account column {account_column!r}")
        mappings[account_type] = account_column
    return mappings


def _load_tddi_accounts(
    path: Path, raw: object, account_columns: tuple[str, ...]
) -> dict[str, TddiAccount]:
    if not isinstance(raw, dict):
        raise ValueError(f"{path}: td_direct_investing_accounts must be an object")
    accounts = {}
    for account_number, values in raw.items():
        label = f"{path}: TD account {account_number!r}"
        if not account_number.strip() or not isinstance(values, dict):
            raise ValueError(f"{label} must be a non-empty object")
        _require_exact_keys(label, values, {"account", "currency"})
        account_column = _required_string(label, values, "account")
        if account_column not in account_columns:
            raise ValueError(f"{label}: unknown account column {account_column!r}")
        currency = _required_string(label, values, "currency").upper()
        accounts[account_number] = TddiAccount(account_column, currency)
    return accounts


def _load_assets(
    path: Path,
    raw: object,
    allowed_asset_types: frozenset[str],
    allowed_markets: frozenset[str],
    allowed_risks: frozenset[str],
) -> dict[str, AssetMetadata]:
    if not isinstance(raw, dict):
        raise ValueError(f"{path}: assets must be an object")
    assets = {}
    for asset, values in raw.items():
        label = f"{path}: asset {asset!r}"
        if not asset.strip() or not isinstance(values, dict):
            raise ValueError(f"{label} must be a non-empty object")
        if asset in CASH_METADATA:
            raise ValueError(f"{label}: cash metadata is built in and must not be configured")
        _require_exact_keys(label, values, {"type", "market", "sector", "risk"})
        asset_type = _required_string(label, values, "type")
        market = _required_string(label, values, "market")
        sector = _required_string(label, values, "sector")
        risk = _required_string(label, values, "risk")
        if asset_type not in allowed_asset_types:
            raise ValueError(f"{label}: unsupported type {asset_type!r}")
        if market not in allowed_markets:
            raise ValueError(f"{label}: unsupported market {market!r}")
        if risk not in allowed_risks:
            raise ValueError(f"{label}: unsupported risk {risk!r}")
        assets[asset] = AssetMetadata(asset_type, market, sector, risk)
    return assets


def _string_list(path: Path, raw: dict, key: str) -> tuple[str, ...]:
    values = raw[key]
    if not isinstance(values, list) or not values:
        raise ValueError(f"{path}: {key} must be a non-empty array")
    result = []
    for value in values:
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"{path}: {key} values must be non-empty strings")
        result.append(value.strip())
    if len(result) != len(set(result)):
        raise ValueError(f"{path}: {key} contains duplicates")
    return tuple(result)


def _validate_cash_metadata(
    path: Path, allowed_markets: frozenset[str], allowed_risks: frozenset[str]
) -> None:
    for asset, metadata in CASH_METADATA.items():
        if metadata.market not in allowed_markets:
            raise ValueError(
                f"{path}: allowed_markets must support {asset} market {metadata.market!r}"
            )
        if metadata.risk not in allowed_risks:
            raise ValueError(f"{path}: allowed_risks must support {asset} risk {metadata.risk!r}")


def _unique_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate key {key!r}")
        result[key] = value
    return result


def _require_exact_keys(label: str, values: dict, expected: set[str]) -> None:
    missing = expected - values.keys()
    unknown = values.keys() - expected
    if missing:
        raise ValueError(f"{label}: missing keys: {', '.join(sorted(missing))}")
    if unknown:
        raise ValueError(f"{label}: unknown keys: {', '.join(sorted(unknown))}")


def _required_string(label: str, values: dict, key: str) -> str:
    value = values[key]
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{label}: {key} must be a non-empty string")
    return value.strip()
