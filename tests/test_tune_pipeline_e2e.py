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
