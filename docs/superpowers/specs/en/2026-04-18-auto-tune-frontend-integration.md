# Auto-Tune Frontend Integration — Design Spec

**Date:** 2026-04-18
**Issue:** #137 (extension)
**Author:** Samuel Ballesteros + Claude Opus

---

## 1. Problem

Auto-tune works via CLI only. Approvals should go through the frontend. Telegram is one-way (notifications only, never for receiving commands).

## 2. Solution

Two modes controlled by a config toggle:

- **Auto-approve (default ON):** Changes applied silently, report saved to DB, Telegram notifies.
- **Manual approve:** Changes saved as "pending", frontend shows notification badge, modal displays full report with accept/reject buttons.

## 3. Database

New table `tune_results`:

```sql
CREATE TABLE tune_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    results_json TEXT,
    report_md TEXT,
    applied_ts TEXT,
    changes_count INTEGER DEFAULT 0
);
```

Status values: `pending`, `applied`, `rejected`

## 4. Config Extension

New field in config.json:

```json
{
    "auto_approve_tune": true
}
```

Default: `true` (auto-approve). Toggle in ConfigPanel.

## 5. Backend API Endpoints

### GET /tune/latest

Returns the most recent tune result. No auth required.

```json
{
    "id": 1,
    "ts": "2026-04-18T03:00:00Z",
    "status": "pending",
    "changes_count": 3,
    "results": [
        {
            "symbol": "DOGEUSDT",
            "recommendation": "CHANGE",
            "current_params": {"atr_sl_mult": 0.7, "atr_tp_mult": 4.0, "atr_be_mult": 1.5},
            "proposed_params": {"atr_sl_mult": 0.5, "atr_tp_mult": 3.0, "atr_be_mult": 2.0},
            "current_val_pnl": 4000,
            "proposal_detail": {
                "val_pnl": 5200,
                "val_pf": 1.28,
                "improvement_pct": 30.0,
                "total_trades": 87
            }
        },
        {
            "symbol": "BTCUSDT",
            "recommendation": "KEEP",
            "current_params": {"atr_sl_mult": 1.0, "atr_tp_mult": 4.0, "atr_be_mult": 1.5}
        }
    ],
    "report_md": "# Auto-Tune Report..."
}
```

Returns `null` if no results exist.

### POST /tune/apply (auth required)

Applies pending proposal:
1. Reads results_json from the pending tune_result
2. Updates config.json symbol_overrides with proposed params
3. Creates config backup
4. Sets status to `applied`, applied_ts to now
5. Returns `{"ok": true, "applied": 3, "backup": "config_backup_20260418.json"}`

### POST /tune/reject (auth required)

Sets pending tune_result status to `rejected`. Returns `{"ok": true}`.

## 6. auto_tune.py Changes

Replace file-based output with DB-based:

1. After optimization, read `auto_approve_tune` from config
2. If `true`:
   - Apply changes to config.json directly (with backup)
   - Insert into `tune_results` with status=`applied`
   - Telegram: "Params actualizados automaticamente. X symbols cambiados."
3. If `false`:
   - Do NOT apply changes
   - Insert into `tune_results` with status=`pending`
   - Telegram: "Nuevos params propuestos. X cambios. Revisar en dashboard."

Keep `--apply` CLI as fallback (reads from DB pending instead of config_proposed.json).

## 7. Frontend Components

### 7.1 ConfigPanel.tsx — New toggle

Add below existing toggles:

```
Auto-Tune Approval
[========] Auto    ← toggle
"Los parametros se aplican automaticamente cada mes"
```

When OFF:
```
Auto-Tune Approval
[        ] Manual
"Recibiras una notificacion para revisar y aprobar cambios"
```

Saves to `POST /config` with `auto_approve_tune` field.

### 7.2 Header.tsx — Notification badge

When `GET /tune/latest` returns status=`pending`:
- Show a subtle pulsing dot/badge on a bell or tune icon in the header
- Click opens TuneReportModal

Checked on each refresh cycle (every 30 seconds, same as existing data).

### 7.3 TuneReportModal.tsx — New component

Professional modal with:

**Header:**
- Title: "Optimizacion de Parametros"
- Subtitle: date + "X cambios propuestos"

**Changes section:**
Table per changed symbol:

```
DOGEUSDT                          Mejora: +30.0%
         SL        TP        BE        P&L Val
Actual   0.7x      4.0x      1.5x      +$4,000
Nuevo    0.5x      3.0x      2.0x      +$5,200
```

**No changes section (collapsed by default):**
"7 symbols sin cambios — parametros actuales son optimos"
Expandable to see the list.

**Footer:**
- "Aplicar Cambios" button (green, prominent)
- "Rechazar" button (gray, subtle)
- Loading state while applying
- Success state: checkmark + "Cambios aplicados"

### 7.4 States

| State | Header | Modal |
|-------|--------|-------|
| No tune results | No badge | Not shown |
| Pending | Pulsing badge | Shows with accept/reject |
| Applied | No badge | Shows as "applied on DATE" (read-only) |
| Rejected | No badge | Shows as "rejected on DATE" (read-only) |

## 8. Files

```
MODIFIED:
  auto_tune.py           — DB integration, auto_approve logic
  btc_api.py             — tune_results table + 3 endpoints + config field
  frontend/src/api.ts    — 3 new API functions
  frontend/src/types.ts  — TuneResult interface
  frontend/src/components/ConfigPanel.tsx  — auto_approve toggle
  frontend/src/components/Header.tsx       — notification badge
  frontend/src/App.tsx   — TuneReportModal integration

NEW:
  frontend/src/components/TuneReportModal.tsx  — report modal
```

## 9. What This Does NOT Cover

- Scheduling (cron stays external)
- Kill switch (#138) — separate feature
- Paper trading (#139) — separate feature
- Historical tune results viewer (only shows latest)
