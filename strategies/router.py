"""
ADX-based strategy router.

Routes each symbol to the correct strategy based on ADX value
and optional per-symbol overrides in config.
"""

ADX_THRESHOLD = 25  # default, overridable per-symbol


def route(adx: float, symbol: str, config: dict) -> str:
    """Decide which strategy to apply.

    Args:
        adx: Current ADX value for the symbol.
        symbol: Trading pair (e.g. "BTCUSDT").
        config: Full config dict (may contain symbol_overrides).

    Returns:
        "mean_reversion" or "trend_following"
    """
    overrides = config.get("symbol_overrides", {})
    sym_cfg = overrides.get(symbol, {})
    if not isinstance(sym_cfg, dict):
        sym_cfg = {}

    # Force strategy if configured
    forced = sym_cfg.get("strategy")
    if forced and forced != "auto":
        return forced

    # Per-symbol ADX threshold
    threshold = sym_cfg.get("adx_threshold", ADX_THRESHOLD)

    return "mean_reversion" if adx < threshold else "trend_following"
