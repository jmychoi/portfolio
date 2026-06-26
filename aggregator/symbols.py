def canonical_symbol(symbol: str, aliases: dict[str, str] | None = None) -> str:
    if aliases is None:
        return symbol
    return aliases.get(symbol, symbol)
