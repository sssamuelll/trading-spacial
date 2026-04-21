"""Regression tests for backtest._close_position helper (#156, #157).

The final-bar close path in simulate_strategy used to:
  - #156: compute pnl_pct with LONG formula unconditionally (SHORT got sign-flipped P&L)
  - #157: omit abs() in sl_pct_actual (SHORT got pnl_usd=0 due to the short-circuit)

Both sites now delegate to _close_position, which handles direction correctly.
"""
import pytest
from datetime import datetime, timezone, timedelta

from backtest import _close_position, RISK_PER_TRADE


ENTRY_TS = datetime(2026, 1, 1, tzinfo=timezone.utc)
EXIT_TS = ENTRY_TS + timedelta(hours=24)


def _make_short_position(entry=50_000.0, sl=55_000.0, tp=40_000.0):
    """SHORT position: sl above entry, tp below entry."""
    return {
        "entry_time": ENTRY_TS,
        "entry_price": entry,
        "direction": "SHORT",
        "sl": sl,
        "sl_orig": sl,
        "tp": tp,
        "size_mult": 1.0,
        "score": 5,
        "be_threshold": entry - 1000,
        "atr_sl_mult_used": 1.0,
        "atr_tp_mult_used": 2.0,
        "atr_be_mult_used": 1.5,
    }


def _make_long_position(entry=50_000.0, sl=45_000.0, tp=60_000.0):
    """LONG position: sl below entry, tp above entry."""
    return {
        "entry_time": ENTRY_TS,
        "entry_price": entry,
        "direction": "LONG",
        "sl": sl,
        "sl_orig": sl,
        "tp": tp,
        "size_mult": 1.0,
        "score": 5,
        "be_threshold": entry + 1000,
        "atr_sl_mult_used": 1.0,
        "atr_tp_mult_used": 2.0,
        "atr_be_mult_used": 1.5,
    }


class TestCloseShortPosition:
    """#156 + #157: SHORT closes must invert the P&L sign and use abs(sl distance)."""

    def test_short_with_price_below_entry_is_profitable(self):
        """SHORT entered at 50k, close at 45k ⇒ +10% profit (was -10% under #156)."""
        trade = _close_position(
            _make_short_position(entry=50_000.0, sl=55_000.0),
            exit_price=45_000.0,
            exit_time=EXIT_TS,
            exit_reason="OPEN",
            capital=10_000.0,
        )
        assert trade["pnl_pct"] == pytest.approx(10.0)
        assert trade["pnl_usd"] > 0, "SHORT winning trade must report positive pnl_usd"

    def test_short_with_price_above_entry_is_loss(self):
        """SHORT entered at 50k, close at 52.5k ⇒ -5% loss."""
        trade = _close_position(
            _make_short_position(entry=50_000.0, sl=55_000.0),
            exit_price=52_500.0,
            exit_time=EXIT_TS,
            exit_reason="OPEN",
            capital=10_000.0,
        )
        assert trade["pnl_pct"] == pytest.approx(-5.0)
        assert trade["pnl_usd"] < 0

    def test_short_pnl_usd_is_nonzero_when_winning(self):
        """#157: sl_pct_actual must use abs() so SHORT winners don't short-circuit to 0."""
        trade = _close_position(
            _make_short_position(entry=50_000.0, sl=55_000.0),
            exit_price=45_000.0,
            exit_time=EXIT_TS,
            exit_reason="OPEN",
            capital=10_000.0,
        )
        expected_sl_pct = abs(50_000.0 - 55_000.0) / 50_000.0 * 100
        expected_pnl_usd = 10_000.0 * RISK_PER_TRADE * 1.0 * (10.0 / expected_sl_pct)
        assert trade["pnl_usd"] == pytest.approx(expected_pnl_usd, rel=1e-3)


class TestCloseLongPosition:
    """Regression: LONG continues to work as before."""

    def test_long_with_price_above_entry_is_profitable(self):
        """LONG entered at 50k, close at 55k ⇒ +10%."""
        trade = _close_position(
            _make_long_position(entry=50_000.0, sl=45_000.0),
            exit_price=55_000.0,
            exit_time=EXIT_TS,
            exit_reason="OPEN",
            capital=10_000.0,
        )
        assert trade["pnl_pct"] == pytest.approx(10.0)
        assert trade["pnl_usd"] > 0

    def test_long_with_price_below_entry_is_loss(self):
        """LONG entered at 50k, close at 47.5k ⇒ -5%."""
        trade = _close_position(
            _make_long_position(entry=50_000.0, sl=45_000.0),
            exit_price=47_500.0,
            exit_time=EXIT_TS,
            exit_reason="OPEN",
            capital=10_000.0,
        )
        assert trade["pnl_pct"] == pytest.approx(-5.0)
        assert trade["pnl_usd"] < 0


class TestCloseTradeShape:
    """Helper must emit the full trade dict shape (keys + types) the rest of the
    pipeline expects. Guard against accidental field drops during refactor."""

    def test_trade_dict_has_expected_keys(self):
        trade = _close_position(
            _make_short_position(),
            exit_price=45_000.0,
            exit_time=EXIT_TS,
            exit_reason="OPEN",
            capital=10_000.0,
        )
        expected_keys = {
            "entry_time", "exit_time", "entry_price", "exit_price", "exit_reason",
            "direction", "pnl_pct", "pnl_usd", "score", "size_mult",
            "duration_hours", "atr_sl_mult_used", "atr_tp_mult_used", "atr_be_mult_used",
        }
        assert expected_keys.issubset(trade.keys()), (
            f"Missing: {expected_keys - trade.keys()}")

    def test_direction_preserved(self):
        t_short = _close_position(_make_short_position(), 45_000.0, EXIT_TS, "OPEN", 10_000.0)
        t_long = _close_position(_make_long_position(), 55_000.0, EXIT_TS, "OPEN", 10_000.0)
        assert t_short["direction"] == "SHORT"
        assert t_long["direction"] == "LONG"
