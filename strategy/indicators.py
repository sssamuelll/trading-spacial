"""Pure technical indicators shared between scanner and backtest (Epic #186)."""
from __future__ import annotations

import numpy as np
import pandas as pd


def calc_lrc(close: pd.Series, period=100, k=2.0):
    """
    Canal de Regresión Lineal.
    Retorna: lrc_pct (0-100), upper, lower, mid
    lrc_pct ≤ 25  →  zona LONG (cuartil inferior del canal)
    """
    if len(close) < period:
        return None, None, None, None
    y    = close.iloc[-period:].values
    x    = np.arange(period)
    m, b = np.polyfit(x, y, 1)
    reg  = m * x + b
    std  = np.std(y - reg)
    upper = reg[-1] + k * std
    lower = reg[-1] - k * std
    mid   = reg[-1]
    price = close.iloc[-1]
    if abs(upper - lower) < 1e-10:
        lrc_pct = 50.0
    else:
        lrc_pct = (price - lower) / (upper - lower) * 100
        lrc_pct = max(0.0, min(100.0, lrc_pct))
    return round(lrc_pct, 2), round(upper, 2), round(lower, 2), round(mid, 2)


def calc_rsi(close: pd.Series, period=14):
    delta    = close.diff()
    gain     = delta.clip(lower=0)
    loss     = (-delta).clip(lower=0)
    avg_gain = gain.ewm(alpha=1 / period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / period, adjust=False).mean()
    rs       = avg_gain / avg_loss.replace(0, np.nan)
    return (100 - 100 / (1 + rs)).fillna(50)


def calc_bb(close: pd.Series, period=20, k=2.0):
    sma = close.rolling(period).mean()
    std = close.rolling(period).std(ddof=0)
    return sma + k * std, sma, sma - k * std   # upper, mid, lower


def calc_sma(close: pd.Series, period: int):
    return close.rolling(period).mean()


def calc_atr(df: pd.DataFrame, period=14) -> pd.Series:
    """Average True Range — mide la volatilidad real del mercado."""
    high = df["high"]
    low = df["low"]
    prev_close = df["close"].shift(1)
    tr = pd.concat([
        high - low,
        (high - prev_close).abs(),
        (low - prev_close).abs(),
    ], axis=1).max(axis=1)
    return tr.rolling(period).mean()


def calc_adx(df: pd.DataFrame, period=14) -> pd.Series:
    """
    Average Directional Index — mide la fuerza de la tendencia (no su dirección).
    ADX < 25  →  mercado lateral/ranging  (apto para mean-reversion)
    ADX >= 25 →  mercado en tendencia     (evitar mean-reversion)

    Pasos:
      1. +DM / -DM desde highs/lows
      2. Suavizar +DM, -DM y TR con EMA (periodo)
      3. +DI = smoothed +DM / ATR * 100
      4. -DI = smoothed -DM / ATR * 100
      5. DX  = |+DI - -DI| / (+DI + -DI) * 100
      6. ADX = EMA de DX (periodo)
    """
    high  = df["high"]
    low   = df["low"]
    close = df["close"]

    # True Range
    prev_close = close.shift(1)
    tr = pd.concat([
        high - low,
        (high - prev_close).abs(),
        (low  - prev_close).abs(),
    ], axis=1).max(axis=1)

    # +DM y -DM
    up_move   = high.diff()
    down_move = (-low).diff()   # equivale a low.shift(1) - low

    plus_dm  = np.where((up_move > down_move) & (up_move > 0), up_move, 0.0)
    minus_dm = np.where((down_move > up_move) & (down_move > 0), down_move, 0.0)

    plus_dm_s  = pd.Series(plus_dm,  index=df.index)
    minus_dm_s = pd.Series(minus_dm, index=df.index)

    # Suavizado con EMA (Wilder: alpha = 1/period)
    alpha = 1.0 / period
    atr_smooth    = tr.ewm(alpha=alpha, adjust=False).mean()
    plus_dm_smooth  = plus_dm_s.ewm(alpha=alpha, adjust=False).mean()
    minus_dm_smooth = minus_dm_s.ewm(alpha=alpha, adjust=False).mean()

    # +DI y -DI
    plus_di  = (plus_dm_smooth  / atr_smooth.replace(0, np.nan)) * 100
    minus_di = (minus_dm_smooth / atr_smooth.replace(0, np.nan)) * 100

    # DX
    di_sum  = plus_di + minus_di
    di_diff = (plus_di - minus_di).abs()
    dx = (di_diff / di_sum.replace(0, np.nan)) * 100

    # ADX = EMA de DX
    adx = dx.ewm(alpha=alpha, adjust=False).mean()
    return adx


def calc_cvd_delta(df: pd.DataFrame, n=3):
    """Proxy CVD: volumen taker buy − sell últimas n barras.

    Data layer bars carry only OHLCV (no taker-side metadata), so
    approximate taker_buy_base from the bar's close position within
    its high-low range, same heuristic the old bybit adapter used.
    """
    if "taker_buy_base" in df.columns:
        taker_buy = df["taker_buy_base"]
    else:
        hl = (df["high"] - df["low"]).replace(0, 1e-9)
        bullish = df["close"] >= df["open"]
        taker_buy = pd.Series(
            np.where(
                bullish,
                df["volume"] * (df["close"] - df["low"]) / hl,
                df["volume"] * (df["high"] - df["close"]) / hl,
            ),
            index=df.index,
        )
    buy  = taker_buy.tail(n)
    sell = (df["volume"] - taker_buy).tail(n)
    return float((buy - sell).sum())
