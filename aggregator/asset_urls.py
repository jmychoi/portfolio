from urllib.parse import quote, urlsplit


def validate_asset_url(raw_url: str, label: str) -> str | None:
    url = raw_url.strip()
    if not url:
        return None
    parsed = urlsplit(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError(f"{label}: URL must be an absolute HTTP or HTTPS URL")
    return url


def yahoo_finance_url(provider_symbol: str) -> str | None:
    symbol = provider_symbol.strip()
    if not symbol:
        return None
    return f"https://finance.yahoo.com/quote/{quote(symbol, safe='.-')}"
