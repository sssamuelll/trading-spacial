"""
Trend-Following Strategy Engine
================================

EMA crossover strategy with DI+/DI- directional filters, ADX strength,
trailing stop sizing, and optional 5M trigger confirmation.

Used when ADX >= threshold (trending market), as routed by strategies.router.
"""

import numpy as np
import pandas as pd

from btc_scanner import (
    calc_rsi,
    calc_atr,
    calc_sma,
    check_trigger_5m,
    check_trigger_5m_short,
    score_label,
    RSI_PERIOD,
    ATR_PERIOD,
    VOL_PERIOD,
    SCORE_MIN_HALF,
    SCORE_STANDARD,
    SCORE_PREMIUM,
)

# ---------------------------------------------------------------------------
# Constants (defaults, overridable per-symbol via config)
# ---------------------------------------------------------------------------
TF_EMA_FAST = 9
TF_EMA_SLOW = 21
TF_EMA_FILTER = 50
TF_ATR_TRAIL = 2.5
TF_RSI_ENTRY_LONG = 55
TF_RSI_ENTRY_SHORT = 45


# ---------------------------------------------------------------------------
# DI+/DI- Calculation
# ---------------------------------------------------------------------------

def calc_di_components(df: pd.DataFrame, period: int = 14):
    """
    Compute DI+ and DI- directional indicators.

    Same math as btc_scanner.calc_adx() but returns the two DI series
    instead of the final ADX value.

    Args:
        df: DataFrame with 'high', 'low', 'close' columns.
        period: Smoothing period (default 14, Wilder).

    Returns:
        (di_plus, di_minus): Tuple of two pd.Series.
    """
    high = df["high"]
    low = df["low"]
    close = df["close"]

    # True Range
    prev_close = close.shift(1)
    tr = pd.concat([
        high - low,
        (high - prev_close).abs(),
        (low - prev_close).abs(),
    ], axis=1).max(axis=1)

    # +DM and -DM
    up_move = high.diff()
    down_move = (-low).diff()  # equivalent to low.shift(1) - low

    plus_dm = np.where((up_move > down_move) & (up_move > 0), up_move, 0.0)
    minus_dm = np.where((down_move > up_move) & (down_move > 0), down_move, 0.0)

    plus_dm_s = pd.Series(plus_dm, index=df.index)
    minus_dm_s = pd.Series(minus_dm, index=df.index)

    # Smooth with EMA (Wilder: alpha = 1/period)
    alpha = 1.0 / period
    atr_smooth = tr.ewm(alpha=alpha, adjust=False).mean()
    plus_dm_smooth = plus_dm_s.ewm(alpha=alpha, adjust=False).mean()
    minus_dm_smooth = minus_dm_s.ewm(alpha=alpha, adjust=False).mean()

    # DI+ and DI-
    di_plus = (plus_dm_smooth / atr_smooth.replace(0, np.nan)) * 100
    di_minus = (minus_dm_smooth / atr_smooth.replace(0, np.nan)) * 100

    return di_plus, di_minus


# ---------------------------------------------------------------------------
# Per-symbol parameter extraction
# ---------------------------------------------------------------------------

def _get_tf_params(symbol: str, config: dict) -> dict:
    """
    Extract per-symbol trend-following parameters from config with defaults.

    Looks in config["symbol_overrides"][symbol] for overrides.
    """
    overrides = config.get("symbol_overrides", {})
    sym_cfg = overrides.get(symbol, {})
    if not isinstance(sym_cfg, dict):
        sym_cfg = {}

    return {
        "tf_ema_fast": sym_cfg.get("tf_ema_fast", TF_EMA_FAST),
        "tf_ema_slow": sym_cfg.get("tf_ema_slow", TF_EMA_SLOW),
        "tf_ema_filter": sym_cfg.get("tf_ema_filter", TF_EMA_FILTER),
        "tf_atr_trail": sym_cfg.get("tf_atr_trail", TF_ATR_TRAIL),
        "tf_rsi_entry_long": sym_cfg.get("tf_rsi_entry_long", TF_RSI_ENTRY_LONG),
        "tf_rsi_entry_short": sym_cfg.get("tf_rsi_entry_short", TF_RSI_ENTRY_SHORT),
        "allow_short": sym_cfg.get("allow_short", True),
        "use_5m_trigger": sym_cfg.get("use_5m_trigger", True),
    }


# ---------------------------------------------------------------------------
# Trend-Following Signal Assessment
# ---------------------------------------------------------------------------

def assess_signal(
    df1h: pd.DataFrame,
    df4h: pd.DataFrame,
    df5m: pd.DataFrame,
    price: float,
    symbol: str,
    regime: str,
    regime_data: dict,
    adx: float,
    di_plus: float,
    di_minus: float,
    config: dict,
) -> dict:
    """
    Assess a trend-following signal for a symbol.

    Entry logic:
      LONG:  EMA(fast) > EMA(slow) AND price > EMA(filter) AND RSI > entry_long AND DI+ > DI- AND regime != "SHORT"
      SHORT: EMA(fast) < EMA(slow) AND price < EMA(filter) AND RSI < entry_short AND DI- > DI+ AND regime != "LONG" AND allow_short

    Scoring (T1-T7, max 9 pts):
      T1_EMA_Cross:         2 pts  - EMA cross in last 3 bars (fresh)
      T2_ADX_Strong:        2 pts  - ADX > 30
      T3_Price_Above_Filter: 1 pt  - price vs EMA filter
      T4_RSI_Momentum:      1 pt   - RSI > 60 (LONG) or < 40 (SHORT)
      T5_Volume:            1 pt   - volume > 20-bar avg
      T6_DI_Spread:         1 pt   - |DI+ - DI-| > 10
      T7_Macro_Aligned:     1 pt   - price vs SMA100 4H

    Returns:
        Dict matching btc_scanner.scan() schema + strategy-specific fields.
    """
    params = _get_tf_params(symbol, config)

    ema_fast_period = params["tf_ema_fast"]
    ema_slow_period = params["tf_ema_slow"]
    ema_filter_period = params["tf_ema_filter"]
    atr_trail_mult = params["tf_atr_trail"]
    rsi_entry_long = params["tf_rsi_entry_long"]
    rsi_entry_short = params["tf_rsi_entry_short"]
    allow_short = params["allow_short"]
    use_5m_trigger = params["use_5m_trigger"]

    # -- Indicators on 1H --
    close_1h = df1h["close"]
    ema_fast = close_1h.ewm(span=ema_fast_period, adjust=False).mean()
    ema_slow = close_1h.ewm(span=ema_slow_period, adjust=False).mean()
    ema_filt = close_1h.ewm(span=ema_filter_period, adjust=False).mean()

    rsi_1h = calc_rsi(close_1h, RSI_PERIOD)
    cur_rsi = round(float(rsi_1h.iloc[-1]), 2)

    cur_ema_fast = float(ema_fast.iloc[-1])
    cur_ema_slow = float(ema_slow.iloc[-1])
    cur_ema_filt = float(ema_filt.iloc[-1])

    vol_avg = float(df1h["volume"].rolling(VOL_PERIOD).mean().iloc[-1])
    cur_vol = float(df1h["volume"].iloc[-1])

    # -- Indicators on 4H (macro) --
    sma100_4h_series = calc_sma(df4h["close"], 100)
    sma100_4h = float(sma100_4h_series.iloc[-1]) if not pd.isna(sma100_4h_series.iloc[-1]) else price
    price_above_sma100_4h = price > sma100_4h

    # -- Direction logic --
    ema_cross_long = cur_ema_fast > cur_ema_slow
    ema_cross_short = cur_ema_fast < cur_ema_slow

    long_conditions = (
        ema_cross_long
        and price > cur_ema_filt
        and cur_rsi > rsi_entry_long
        and di_plus > di_minus
        and regime != "SHORT"
    )

    short_conditions = (
        ema_cross_short
        and price < cur_ema_filt
        and cur_rsi < rsi_entry_short
        and di_minus > di_plus
        and regime != "LONG"
        and allow_short
    )

    direction = None
    if long_conditions:
        direction = "LONG"
    elif short_conditions:
        direction = "SHORT"

    # -- Scoring (T1-T7) --
    score = 0
    conf = {}

    def add(key, pts, passed, extra=None):
        nonlocal score
        pts_earned = pts if passed else 0
        score += pts_earned
        entry = {"pass": passed, "pts": pts_earned, "max_pts": pts}
        if extra:
            entry.update(extra)
        conf[key] = entry

    # T1: EMA cross freshness (in last 3 bars)
    ema_diff = ema_fast - ema_slow
    if direction == "SHORT":
        # Cross below: was positive, now negative
        cross_fresh = any(
            float(ema_diff.iloc[-(i + 1)]) > 0
            for i in range(1, min(4, len(ema_diff)))
            if not pd.isna(ema_diff.iloc[-(i + 1)])
        ) and float(ema_diff.iloc[-1]) < 0
    else:
        # Cross above: was negative, now positive
        cross_fresh = any(
            float(ema_diff.iloc[-(i + 1)]) < 0
            for i in range(1, min(4, len(ema_diff)))
            if not pd.isna(ema_diff.iloc[-(i + 1)])
        ) and float(ema_diff.iloc[-1]) > 0
    add("T1_EMA_Cross", 2, cross_fresh)

    # T2: ADX strength
    add("T2_ADX_Strong", 2, adx > 30, {"adx": round(adx, 2)})

    # T3: Price vs EMA filter
    if direction == "SHORT":
        price_filter_ok = price < cur_ema_filt
    else:
        price_filter_ok = price > cur_ema_filt
    add("T3_Price_Above_Filter", 1, price_filter_ok,
        {"price": round(price, 2), "ema_filter": round(cur_ema_filt, 2)})

    # T4: RSI momentum
    if direction == "SHORT":
        rsi_momentum = cur_rsi < 40
    else:
        rsi_momentum = cur_rsi > 60
    add("T4_RSI_Momentum", 1, rsi_momentum, {"rsi_1h": cur_rsi})

    # T5: Volume above average
    add("T5_Volume", 1, cur_vol > vol_avg,
        {"vol_ratio": round(cur_vol / vol_avg, 2) if vol_avg > 0 else 0})

    # T6: DI spread
    di_spread = abs(di_plus - di_minus)
    add("T6_DI_Spread", 1, di_spread > 10,
        {"di_spread": round(di_spread, 2)})

    # T7: Macro aligned (price vs SMA100 4H)
    if direction == "SHORT":
        macro_aligned = not price_above_sma100_4h
    else:
        macro_aligned = price_above_sma100_4h
    add("T7_Macro_Aligned", 1, macro_aligned,
        {"sma100_4h": round(sma100_4h, 2), "price_above": price_above_sma100_4h})

    # -- 5M Trigger --
    trigger_active = False
    trigger_details = {}

    if direction is not None and use_5m_trigger:
        if direction == "SHORT":
            trigger_active, trigger_details = check_trigger_5m_short(df5m)
        else:
            trigger_active, trigger_details = check_trigger_5m(df5m)
    elif direction is not None and not use_5m_trigger:
        # EMA cross IS the trigger
        trigger_active = True
        trigger_details = {"mode": "ema_cross_trigger", "5m_disabled": True}

    # -- Sizing (trailing stop, no fixed TP) --
    atr_val = float(calc_atr(df1h, ATR_PERIOD).iloc[-1])
    capital = 1000.0
    risk_usd = capital * 0.01

    sl_dist = atr_val * atr_trail_mult

    if direction == "SHORT":
        sl_price = round(price + sl_dist, 2)
    else:
        sl_price = round(price - sl_dist, 2)

    sl_pct_val = round(sl_dist / price * 100, 2) if price > 0 else 0

    # Size multiplier based on score tiers
    if score >= SCORE_PREMIUM:
        size_mult = 1.5
    elif score >= SCORE_STANDARD:
        size_mult = 1.0
    else:
        size_mult = 0.5

    adjusted_risk = risk_usd * size_mult
    qty = adjusted_risk / sl_dist if sl_dist > 0 else 0
    val_pos = qty * price
    if val_pos > capital * 0.98:
        qty = (capital * 0.98) / price
        val_pos = qty * price

    # -- Estado (verdict) --
    blocks = []
    if direction is None:
        estado = "⏳ SIN SETUP — EMA sin cruce direccional"
        senal = False
    elif blocks:
        estado = f"🚫 BLOQUEADA {direction} — {len(blocks)} exclusion(es)"
        senal = False
    elif not trigger_active:
        estado = f"🕐 SETUP {direction} VALIDO — Esperando gatillo 5M"
        senal = False
    else:
        sl = score_label(score)
        estado = f"✅ SENAL {direction} + GATILLO CONFIRMADOS — Calidad: {sl}"
        senal = True

    # -- Build output --
    result = {
        "strategy": "trend_following",
        "estado": estado,
        "señal_activa": senal,
        "direction": direction,
        "regime": regime_data.get("regime"),
        "regime_score": regime_data.get("score"),
        "regime_details": regime_data.get("details"),
        "price": round(price, 2),
        "rsi_1h": cur_rsi,
        "adx_1h": round(adx, 2),
        "macro_4h": {
            "sma100": round(sma100_4h, 2),
            "price_above": price_above_sma100_4h,
        },
        "score": score,
        "score_label": score_label(score),
        "confirmations": conf,
        "exclusions": {},
        "blocks_auto": blocks,
        "gatillo_5m": trigger_details,
        "gatillo_activo": trigger_active,
        "tf_indicators": {
            "ema_fast": round(cur_ema_fast, 2),
            "ema_slow": round(cur_ema_slow, 2),
            "ema_filter": round(cur_ema_filt, 2),
            "trailing_stop": round(sl_dist, 2),
            "di_plus": round(di_plus, 2),
            "di_minus": round(di_minus, 2),
        },
        "sizing_1h": {
            "capital_usd": capital,
            "riesgo_usd": round(adjusted_risk, 2),
            "atr_1h": round(atr_val, 2),
            "atr_trail_mult": atr_trail_mult,
            "sl_mode": "trailing",
            "sl_pct": f"{sl_pct_val}%",
            "sl_precio": sl_price,
            "tp_precio": None,
            "size_mult": size_mult,
            "qty": round(qty, 6),
            "valor_pos": round(val_pos, 2),
            "pct_capital": round(val_pos / capital * 100, 1) if capital > 0 else 0,
        },
    }

    return result
