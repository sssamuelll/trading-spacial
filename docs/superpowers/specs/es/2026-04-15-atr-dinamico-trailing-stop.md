# ATR Dinamico + Trailing Ratchet Stop

**Fecha:** 2026-04-15
**Issue:** #113 (SL/TP dinamico) + #114 (trailing stop)
**Estado:** Aprobado

## Problema

El backtest mostro que la estrategia **pierde dinero en bull markets** (-$389) porque el SL fijo de 2% se activa prematuramente en periodos de alta volatilidad. El TP fijo de 4% tambien limita las ganancias cuando la tendencia continua.

## Solucion

Reemplazar SL/TP fijo por ATR(14) dinamico con trailing ratchet, siguiendo el patron probado por Freqtrade y Jesse.

### Parametros (basados en consenso de la comunidad)

| Parametro | Valor | Descripcion |
|-----------|-------|-------------|
| `ATR_PERIOD` | 14 | Periodo del ATR (estandar) |
| `ATR_SL_MULT` | 1.5 | SL = entry - 1.5x ATR |
| `ATR_TP_MULT` | 3.0 | TP = entry + 3.0x ATR |
| `ATR_BE_MULT` | 1.5 | Mover SL a breakeven cuando profit >= 1.5x ATR |
| Timeframe | 1H | ATR calculado en el timeframe de senal (no 5M) |

### Ratio R:R

Se mantiene el ratio 2:1 (TP = 2x SL) pero ahora adaptado a la volatilidad real:
- Mercado calmado (ATR bajo): SL tight, TP modesto
- Mercado volatil (ATR alto): SL amplio, TP ambicioso

## Cambios por Componente

### 1. Scanner (`btc_scanner.py`)

**Nueva funcion `calc_atr()`:**
- Calcula True Range (max de: high-low, |high-prev_close|, |low-prev_close|)
- Media movil de `period` barras

**Nuevas constantes:**
- `ATR_PERIOD = 14`
- `ATR_SL_MULT = 1.5`
- `ATR_TP_MULT = 3.0`
- `ATR_BE_MULT = 1.5`

**Constantes anteriores se mantienen** como fallback: `SL_PCT`, `TP_PCT`

**En `scan()`:** El bloque de sizing calcula SL/TP con ATR en vez de porcentaje fijo. El reporte incluye `atr_1h`, `sl_mode`, y los multiplicadores usados.

**Config override:** `config.json` permite `"sl_mode": "fixed"` para volver al comportamiento original.

### 2. API (`btc_api.py`)

**Tabla `positions`:** Nueva columna `atr_entry REAL` — almacena el ATR al momento de abrir la posicion.

**`check_position_stops()`:** Ademas de evaluar SL/TP hit, implementa trailing ratchet:
- Si precio >= entry + 1.5x ATR → mover SL a entry (breakeven)
- SL solo sube, nunca baja (ratchet)

**`config.json`:** Nuevos parametros `atr_sl_mult`, `atr_tp_mult`, `atr_be_mult`, `sl_mode`.

### 3. Frontend

**`types.ts`:** Agregar `atr_entry?: number | null` al tipo Position.

**`PositionsPanel.tsx`:** Badge "BE" verde cuando `sl_price >= entry_price` (breakeven activo).

**`SignalsTable.tsx` / `SymbolCard.tsx`:** Mostrar SL/TP como porcentaje dinamico con indicador "(ATR)".

**`ChartModal.tsx`:** Agregar chips de ATR, SL%, TP% junto al score.

### 4. Backtest (`backtest.py`)

**Modo dual:** `--sl-mode atr` (default) vs `--sl-mode fixed` para comparar.

Cambios: calcular ATR por barra, SL/TP dinamicos, trailing ratchet, reporte comparativo.

### 5. Tests

- `calc_atr()`: valores positivos, largo correcto, datos insuficientes
- SL/TP con ATR: `sl = price - 1.5 * atr`, `tp = price + 3.0 * atr`
- Trailing ratchet: SL sube a breakeven, nunca baja
- Fallback `sl_mode: fixed`: comportamiento original intacto
- Config: multiplicadores leidos correctamente

## Que NO Cambia

- Logica de scoring (C1-C7)
- Filtros de exclusion (E1, E6)
- Macro filter 4H (SMA100)
- Gatillo 5M
- Cooldown entre trades
- Riesgo base por trade (1%)

## Benchmark

Patron basado en:
- **Freqtrade `custom_stoploss` + `stoploss_from_absolute`:** ATR(14), 1.5x SL, lock at entry, ratchet only
- **Jesse `update_position()`:** ATR recalculado cada vela, stop solo tightena
- **NostalgiaForInfinity (NFIX):** 1.0-2.0x ATR SL, varying by buy tag
- **Consenso comunidad:** ATR(14) en timeframe de senal (1H), nunca 5M (demasiado ruidoso)
