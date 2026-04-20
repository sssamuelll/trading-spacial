"""Regression guard: with a flat-dict config (the shape in production today),
btc_scanner.resolve_direction_params must produce stable output.

This test pins the behaviour of the resolver's Form 1 (flat dict) — the most
common config shape in production. Any drift in the resolver's defaults or
precedence will ring here.
"""
import pytest
import btc_scanner as scanner


def test_flat_config_produces_expected_sizing():
    """Flat dict → same triplet for LONG and SHORT, identical keys."""
    overrides = {"BTCUSDT": {"atr_sl_mult": 1.0, "atr_tp_mult": 4.0, "atr_be_mult": 1.5}}
    expected = {"atr_sl_mult": 1.0, "atr_tp_mult": 4.0, "atr_be_mult": 1.5}

    assert scanner.resolve_direction_params(overrides, "BTCUSDT", "LONG") == expected
    assert scanner.resolve_direction_params(overrides, "BTCUSDT", "SHORT") == expected


def test_empty_overrides_uses_global_defaults():
    """No overrides → global ATR_SL_MULT / ATR_TP_MULT / ATR_BE_MULT defaults."""
    assert scanner.resolve_direction_params({}, "BTCUSDT", "LONG") == {
        "atr_sl_mult": scanner.ATR_SL_MULT,
        "atr_tp_mult": scanner.ATR_TP_MULT,
        "atr_be_mult": scanner.ATR_BE_MULT,
    }
