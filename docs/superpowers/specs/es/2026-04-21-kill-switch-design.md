# Kill switch automático — diseño

**Issue:** [#138](https://github.com/sssimon/trading-spacial/issues/138)
**Autor:** Samuel / Claude
**Fecha:** 2026-04-21
**Status:** aprobado, listo para planificar
**Depende de:** [#162 notifier centralizado](2026-04-21-notifier-centralizado-design.md) (PR A mínimo)

## 1. Resumen

Sistema que monitorea la salud por símbolo en 3 niveles escalonados (ALERT → REDUCED → PAUSED) y automáticamente:
- Alerta vía Telegram si el win rate cae
- Reduce el sizing si hay P&L negativo sostenido
- Pausa el símbolo si acumula 3 meses calendario consecutivos negativos

El operador reactiva manualmente los símbolos PAUSED después de revisión humana.

Se divide en **4 PRs en serie**:

- **PR 1 — Foundation:** schema + rolling metrics + state machine + persistencia + endpoints. **Sin cambiar comportamiento de trading.**
- **PR 2 — Alert tier:** transición NORMAL→ALERT, notificación Telegram + prefix ⚠️ en mensajes de signal.
- **PR 3 — Reduce tier:** transición ALERT→REDUCED, size_mult × 0.5 en scanner + backtest.
- **PR 4 — Pause tier:** transición REDUCED→PAUSED, skip de signals + reactivación manual (CLI + endpoint).

## 2. Motivación

Epic #135 confirmó vía 768+ combinaciones de backtest que 13 de los 23 símbolos originales (BNB, SOL, XRP, DOT, MATIC, LINK, LTC, ATOM, NEAR, FIL, APT, OP, ARB) no son rentables con esta estrategia. Se dropeearon manualmente el 2026-04-18. Durante los meses previos al descubrimiento se perdió dinero real operando esos tokens. Un kill switch automático habría cortado las pérdidas sin esperar revisión humana.

## 3. Scope

### Incluido

- Módulo `health.py` con lógica pura (rolling metrics + state machine) y thin wrapper de persistencia.
- Tablas `symbol_health` (estado actual) + `symbol_health_events` (histórico de transiciones).
- Integración en scanner: skip símbolos PAUSED, aplicar factor de sizing en REDUCED.
- Notificaciones Telegram en transiciones (delegadas al notifier de #162).
- Reactivación manual: CLI script + endpoint API.
- Config en `config.json` con defaults sensatos.

### Fuera de scope

- Reporte semanal de salud del portfolio (mencionado en issue #138 pero separado a otro issue pa' no bloar este épico).
- Frontend UI pa' gestionar pausa/reactivación (queda pa' después; por ahora CLI + endpoint).
- Reglas adaptativas basadas en ML (threshold recalibration automático): fuera de scope completamente.

## 4. Decisiones clave

Las decisiones fueron tomadas durante el brainstorming del 2026-04-21:

| Decisión | Elección | Rationale |
|---|---|---|
| División en PRs | 4 en serie | Foundation-first → Alert → Reduce → Pause |
| Persistencia | Tablas DB | Histórico consultable; sobrevive restarts |
| "3 meses consecutivos" | Mes calendario (Ene, Feb, Mar todos con `sum(pnl) < 0`) | Claro, simple, consistente con lenguaje financiero |
| Cold start | Skip checks si `trades < 20` | Conservador: no pausar por falta de data |
| Thresholds | En `config.json` | Simon puede ajustar sin tocar código |
| Timing evaluación | Híbrido: daily cron @ 00:00 UTC + trigger en cada cierre de posición | Consistente pa' símbolos inactivos + responsivo a nueva data |

## 5. Arquitectura

```
┌─────────────────────────────────────────────────────────┐
│                    btc_api.py                           │
│  ┌───────────────┐     ┌────────────────────────────┐   │
│  │ scanner_loop  │     │ health_monitor_loop (new)  │   │
│  │  (every 300s) │     │  - on position close       │   │
│  │               │     │  - daily @ 00:00 UTC       │   │
│  └───────┬───────┘     └──────────┬─────────────────┘   │
│          │                        │                      │
│          ▼                        ▼                      │
│  ┌──────────────────────────────────────────────┐       │
│  │         health.py (new module)               │       │
│  │  compute_rolling_metrics(symbol) → dict      │       │
│  │  evaluate_state(metrics, cur_state, cfg) →   │       │
│  │      (new_state, reason)                     │       │
│  │  apply_transition(symbol, new_state, reason) │       │
│  │  get_symbol_state(symbol) → state            │       │
│  └──────────────────────────────────────────────┘       │
│                         │                                │
│                         ▼                                │
│  ┌──────────────────────────────────────────────┐       │
│  │         signals.db                           │       │
│  │  - positions  (existing)                     │       │
│  │  - symbol_health (new)                       │       │
│  │  - symbol_health_events (new)                │       │
│  └──────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────┘
          │
          │ notify(HealthEvent(...))
          ▼
    notifier module (#162)
```

### Módulos

- `health.py` — lógica pura + thin persistence wrapper.
- `btc_api.py` — host de `health_monitor_loop` (nuevo thread) + endpoints de consulta/reactivación.
- `btc_scanner.scan()` — consulta `get_symbol_state(symbol)` antes de generar signal.
- `backtest.simulate_strategy` — también consulta estado si caller pasa `apply_kill_switch=True` (para backtests reproducibles); por default OFF.

## 6. Schema DB

```sql
-- SCHEMA_VERSION bump: 3 → 4 (migración idempotente)

CREATE TABLE symbol_health (
    symbol              TEXT PRIMARY KEY,
    state               TEXT NOT NULL DEFAULT 'NORMAL',  -- NORMAL | ALERT | REDUCED | PAUSED
    state_since         TEXT NOT NULL,                   -- ISO timestamp de entrada al estado actual
    last_evaluated_at   TEXT NOT NULL,
    last_metrics_json   TEXT,                            -- snapshot del cálculo más reciente
    manual_override     INTEGER NOT NULL DEFAULT 0       -- 1 si un humano reactivó/forzó
);

CREATE TABLE symbol_health_events (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol          TEXT NOT NULL,
    from_state      TEXT NOT NULL,
    to_state        TEXT NOT NULL,
    trigger_reason  TEXT NOT NULL,
    -- reasons: 'wr_below_threshold' | 'pnl_neg_30d' | '3mo_consec_neg' |
    --          'manual_override' | 'auto_recovery' | 'override_expired'
    metrics_json    TEXT NOT NULL,                       -- snapshot al momento de la transición
    ts              TEXT NOT NULL
);

CREATE INDEX idx_health_events_symbol ON symbol_health_events(symbol, ts DESC);
```

**Invariantes:**
- `state_since` se actualiza solo al transicionar (no en cada evaluate sin cambio).
- `last_evaluated_at` se actualiza cada evaluación.
- `metrics_json` en `symbol_health_events` captura el contexto exacto de la decisión (auditoría + debugging).
- Nunca se borran rows de `symbol_health_events` (append-only).

## 7. State machine

```
         (win rate < 15% en últimos ≥20 trades)
  NORMAL ──────────────────────────────────▶ ALERT
     ▲                                         │
     │                                         │ (P&L neg últimos 30d)
     │   (auto-recovery)                       ▼
     │                                      REDUCED
     │                                         │
     │                                         │ (3 meses calendario
     │                                         │  consecutivos P&L<0)
     │                                         ▼
     │                                      PAUSED
     │                                         │
     └─────────────────(manual reactivation)◀──┘
```

### Reglas de transición (evaluadas en este orden, primera que matchea gana)

Given `metrics = compute_rolling_metrics(symbol)`:

1. **Cold start guard:** `metrics.trades_count < config.min_trades_for_eval (20)` → return `(current_state, 'insufficient_data')`, no transición.
2. **PAUSED:** `3_consecutive_calendar_months_negative(metrics)` → `PAUSED`, reason=`'3mo_consec_neg'`.
3. **REDUCED:** `metrics.pnl_30d < 0` → `REDUCED`, reason=`'pnl_neg_30d'`.
4. **ALERT:** `metrics.win_rate_20_trades < 0.15` → `ALERT`, reason=`'wr_below_threshold'`.
5. **Default NORMAL:** ninguna regla aplica.

### Auto-recovery

- Si `current_state != NORMAL` y ninguna regla de degradación matchea → transición a `NORMAL` con reason=`'auto_recovery'`.
- **Excepción:** si `manual_override == 1` (humano reactivó), la auto-recovery respeta la reactivación y NO se aplica de nuevo hasta que el override expire o se rompa una regla más severa.

### Manual override

- Reactivación manual (vía CLI/endpoint): set `state='NORMAL'`, `manual_override=1`, record event con reason=`'manual_override'`.
- El override **expira** cuando:
  - Una evaluación encuentra una regla de degradación que APLICA (ej: 3 meses negativos de nuevo después de reactivar) → override cleared, transición al nuevo estado con reason=`'override_expired'`.
  - (Opcional futuro) Cumplido un período de grace (ej: 30 días) el override se limpia automáticamente.

**Idempotencia:** si `evaluate_state` retorna el mismo `state` que el actual → solo update de `last_evaluated_at`, **no** row en `symbol_health_events`.

## 8. Config

```json
"kill_switch": {
  "enabled": true,
  "min_trades_for_eval": 20,
  "alert_win_rate_threshold": 0.15,
  "reduce_pnl_window_days": 30,
  "reduce_size_factor": 0.5,
  "pause_months_consecutive": 3,
  "auto_recovery_enabled": true
}
```

Si `enabled=false`: `health_monitor_loop` no corre, `get_symbol_state` retorna siempre `NORMAL`. Backward-compat total.

## 9. PR breakdown

### PR 1 — Foundation (~1.5 días)

**Incluye:**
- Schema migration v3→v4 (ambas tablas nuevas)
- `health.py` módulo completo:
  - `compute_rolling_metrics(symbol, conn) → dict` (pure, reads positions table)
  - `evaluate_state(metrics, current_state, manual_override, config) → (new_state, reason)` (pure)
  - `apply_transition(symbol, new_state, reason, metrics)` (persists)
  - `get_symbol_state(symbol) → str` (fast read-only)
- `health_monitor_loop()` thread en `btc_api.py`:
  - Daily cron @ 00:00 UTC + triggered on position close
  - Llama `compute + evaluate + apply` por symbol
- API endpoints:
  - `GET /health/symbols` — list de estado actual por symbol
  - `GET /health/events?symbol=X&limit=50` — histórico
  - `POST /health/reactivate/{symbol}` — manual override (used in PR 4)
- Tests: state machine transiciones, rolling metrics, cold start, idempotencia, migration.

**Trading behavior: UNCHANGED.** Solo observa y guarda. Notificaciones Telegram aún no disparadas (PR 2 las añade).

### PR 2 — Alert tier (~0.5 días)

**Incluye:**
- `scan()` / scanner consulta `get_symbol_state(symbol)`:
  - Si `ALERT` → append prefijo `⚠️ ALERT` al event pasado a notifier
- Notificación Telegram one-shot en transición NORMAL→ALERT via `notify(HealthEvent(...))` (usa #162).
- Tests: NORMAL→ALERT dispara 1 `notify()`; signal telegram message incluye el prefijo; no dispara en evaluaciones subsiguientes mientras siga en ALERT.

### PR 3 — Reduce tier (~0.5 días)

**Incluye:**
- `scan()` y `simulate_strategy` aplican `size_mult *= config.reduce_size_factor` si `state == REDUCED`.
- Notificación Telegram en transición a REDUCED.
- Tests: position size reducido correctamente; REDUCED→NORMAL auto-recovery no afecta trades ya abiertos.

### PR 4 — Pause tier + reactivación manual (~1 día)

**Incluye:**
- `scan()` retorna early sin generar signal si `state == PAUSED`.
- Notificación Telegram prominente en transición a PAUSED.
- CLI: `python scripts/reactivate_symbol.py BTCUSDT --reason "backtest validated"`.
- Endpoint: `POST /health/reactivate/{symbol}` con body `{"reason": "..."}` (ya creado en PR 1, ahora con side effects).
- Tests: symbol PAUSED no genera signals; reactivación manual sets state=NORMAL y manual_override=1; override persiste a través de 1 evaluación subsiguiente; override expira si una nueva regla de degradación matchea.

## 10. Testing

### Unit (health.py)

- `compute_rolling_metrics`:
  - Symbol sin trades → dict vacío con `trades_count=0`.
  - Symbol con 10 trades → todos los contadores correctos.
  - Ventanas rolling: últimos 20 trades, últimos 30 días, agregación mensual calendario.
- `evaluate_state`:
  - Matrix de todos los estados × todas las métricas → transición esperada.
  - Cold start (trades<20) → no transición.
  - Manual override behavior (respeta reactivación hasta criterio agravado).
  - Orden de reglas (PAUSED > REDUCED > ALERT > NORMAL).
  - Idempotencia (mismo state → no event row).

### Integración

- End-to-end: insertar posiciones con pnl en DB → llamar `health_monitor_loop once` → verificar estado + events.
- Migration idempotente: correr 2x seguidas → schema version=4 ambas veces, no duplica rows.

### PRs downstream

- PR 2: fixture con symbol en ALERT → scan produce message con prefijo ⚠️.
- PR 3: fixture con symbol en REDUCED → position tiene size_usd reducido por factor 0.5.
- PR 4: fixture con symbol en PAUSED → scan no produce signal; reactivación vía endpoint setea state=NORMAL.

## 11. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Auto-recovery demasiado agresiva reactiva un symbol malo | Manual_override flag + confirmar 3 meses POSITIVOS antes de exit PAUSED (criterio adicional, revisable) |
| Flapping NORMAL↔ALERT en trades borderline | Hysteresis (ej: pa' volver a NORMAL desde ALERT, win_rate debe ser ≥20%, no solo ≥15%). Pendiente de implementar en PR 2 si se observa. |
| Bugs en state machine afectan trading real | PR 1 Foundation NO cambia trading behavior. 2 PRs de separación pa' validar el pipeline antes de hooks en scanner. |
| Daily cron no corre (thread muere, API cae) | health_monitor_loop en mismo thread que scanner_loop, supervisado por `watchdog.py`. Además, trigger on-position-close da cobertura adicional. |
| `config.json` sin bloque `kill_switch` rompe existing config | Shim defaults en code. `enabled=true` es el default solo si la key existe. |
| Backtest reproducibility con kill switch activo | Kill switch NO se aplica en backtest por default (apply_kill_switch=False). Opcional en scripts que lo necesiten. |

## 12. Métricas de éxito

- Kill switch detecta un symbol que acumula 3 meses perdiendo y lo pausa automáticamente.
- 0 falsos positivos en símbolos rentables conocidos (BTC, DOGE según validación actual).
- Reactivación manual funcional y auditada en `symbol_health_events`.
- Drawdown del portfolio reducido medible si un symbol entra en PAUSED (validación pide datos reales post-deploy, no es métrica pre-merge).

## 13. Dependencias

- **Precede:** ninguno (este es un feature nuevo).
- **Depende de:** #162 PR A (notifier core) debe mergear antes del PR 2 de este épico.
- **Modifica:** `btc_api.py` (loop nuevo + endpoints), `btc_scanner.py` (PRs 2/3/4), `backtest.py` (PR 3 opcional), `frontend/` (no en este épico — queda pa' follow-up).
