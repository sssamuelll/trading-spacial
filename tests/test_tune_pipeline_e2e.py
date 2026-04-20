import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


@pytest.mark.network
class TestTuneScriptE2E:
    def test_tune_script_produces_valid_json(self, tmp_path):
        """Run tune_per_direction with a reduced grid on mini data; verify JSON schema."""
        out = tmp_path / "tune_out.json"
        result = subprocess.run([
            sys.executable, str(ROOT / "scripts" / "tune_per_direction.py"),
            "--train-start", "2025-10-01",
            "--train-end",   "2025-12-01",
            "--symbols",     "BTCUSDT",
            "--output",      str(out),
            "--parallel",    "1",
            "--test-mode",
        ], capture_output=True, text=True, cwd=str(ROOT), timeout=600)
        assert result.returncode == 0, f"stderr: {result.stderr}"
        assert out.exists()

        data = json.loads(out.read_text())
        assert "train_start" in data
        assert "train_end" in data
        assert "generated_at" in data
        assert "git_sha" in data
        assert "grid" in data
        assert "results" in data
        assert "BTCUSDT" in data["results"]
        for direction in ["long", "short"]:
            assert direction in data["results"]["BTCUSDT"]
            node = data["results"]["BTCUSDT"][direction]
            assert "best" in node or "skip_reason" in node
            if "best" in node:
                b = node["best"]
                assert "atr_sl_mult" in b
                assert "atr_tp_mult" in b
                assert "atr_be_mult" in b
                assert "N" in b
                assert "pf" in b
                assert "pnl" in b


class TestApplyTuneScript:
    def test_apply_tune_produces_valid_config_patch(self, tmp_path):
        """Given a synthetic tune_results.json, apply produces a well-formed config."""
        tune_out = tmp_path / "tune.json"
        tune_out.write_text(json.dumps({
            "train_start": "2022-01-01", "train_end": "2024-12-31",
            "generated_at": "2026-04-20T00:00:00Z", "git_sha": "abc",
            "grid": {"sl": [1.0], "tp": [4.0], "be": [1.5]},
            "results": {
                "BTCUSDT": {
                    "long":  {"best": {"atr_sl_mult": 1.0, "atr_tp_mult": 4.0, "atr_be_mult": 1.5,
                                         "N": 100, "pnl": 5000, "pf": 1.5}},
                    "short": {"best": {"atr_sl_mult": 1.2, "atr_tp_mult": 3.0, "atr_be_mult": 2.0,
                                         "N": 100, "pnl": 6000, "pf": 1.8}},
                },
                "RUNEUSDT": {
                    "long":  {"best": {"atr_sl_mult": 0.7, "atr_tp_mult": 6.0, "atr_be_mult": 2.5,
                                         "N": 80, "pnl": 3000, "pf": 1.2}},
                    "short": {"best": {"atr_sl_mult": 1.0, "atr_tp_mult": 3.0, "atr_be_mult": 2.0,
                                         "N": 15, "pnl": -500, "pf": 0.6}},
                },
            },
        }))
        base_cfg = tmp_path / "config.json"
        base_cfg.write_text(json.dumps({"scan_interval_sec": 300}))
        patched = tmp_path / "config.tuned.json"

        result = subprocess.run([
            sys.executable, str(ROOT / "scripts" / "apply_tune_to_config.py"),
            "--tune-results", str(tune_out),
            "--base-config", str(base_cfg),
            "--output", str(patched),
        ], capture_output=True, text=True, cwd=str(ROOT), timeout=30)
        assert result.returncode == 0, f"stderr: {result.stderr}"

        data = json.loads(patched.read_text())
        assert "symbol_overrides" in data
        assert data["scan_interval_sec"] == 300  # base preserved

        btc = data["symbol_overrides"]["BTCUSDT"]
        # BTCUSDT: both dedicated (N=100, PF=1.5 and 1.8) → {long: {...}, short: {...}}
        assert "long" in btc and isinstance(btc["long"], dict)
        assert "short" in btc and isinstance(btc["short"], dict)
        assert btc["long"]["atr_sl_mult"] == 1.0
        assert btc["short"]["atr_sl_mult"] == 1.2

        rune = data["symbol_overrides"]["RUNEUSDT"]
        # RUNEUSDT: long=fallback (PF=1.2 < 1.3), short=disabled (N=15 < 30 OR PF=0.6 < 1.0)
        # Expected form: mix — flat triplet from long (the non-disabled tier), short: null
        assert rune.get("short") is None
        assert rune.get("atr_sl_mult") == 0.7  # from the "fallback" LONG tier


class TestGateScript:
    def test_gate_pass_when_improvement(self):
        """Synthetic case where tuned beats baseline — PASS."""
        from scripts.gate_per_direction import evaluate_gate
        baseline = {
            "total_pnl": 20000, "max_dd_pct": -10.0,
            "per_symbol": {"BTCUSDT": {"pnl": 5000, "pf": 1.4},
                            "DOGEUSDT": {"pnl": 10000, "pf": 4.5}},
        }
        tuned = {
            "total_pnl": 23000,  # +15%
            "max_dd_pct": -9.0,   # better
            "per_symbol": {"BTCUSDT": {"pnl": 5200, "pf": 1.4},
                            "DOGEUSDT": {"pnl": 11000, "pf": 4.7}},
        }
        verdict, reasons = evaluate_gate(baseline, tuned)
        assert verdict == "PASS", reasons

    def test_gate_fail_when_doge_pf_drops(self):
        from scripts.gate_per_direction import evaluate_gate
        baseline = {"total_pnl": 20000, "max_dd_pct": -10.0,
                    "per_symbol": {"DOGEUSDT": {"pnl": 10000, "pf": 4.5}}}
        tuned = {"total_pnl": 25000, "max_dd_pct": -9.0,
                 "per_symbol": {"DOGEUSDT": {"pnl": 10500, "pf": 3.8}}}
        verdict, reasons = evaluate_gate(baseline, tuned)
        assert verdict == "FAIL"
        assert any("DOGE" in r for r in reasons)

    def test_gate_fail_when_per_symbol_regresses(self):
        from scripts.gate_per_direction import evaluate_gate
        baseline = {"total_pnl": 20000, "max_dd_pct": -10.0,
                    "per_symbol": {"BTCUSDT": {"pnl": 5000, "pf": 1.4},
                                     "DOGEUSDT": {"pnl": 10000, "pf": 4.5}}}
        tuned = {"total_pnl": 25000, "max_dd_pct": -9.0,
                 "per_symbol": {"BTCUSDT": {"pnl": 3000, "pf": 1.4},  # -40%
                                  "DOGEUSDT": {"pnl": 12000, "pf": 4.6}}}
        verdict, reasons = evaluate_gate(baseline, tuned)
        assert verdict == "FAIL"
        assert any("BTCUSDT" in r for r in reasons)
