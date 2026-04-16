# Senales SHORT — Operaciones en Ambas Direcciones

**Fecha:** 2026-04-16
**Issue:** #58
**Estado:** Aprobado

## Problema

La estrategia Spot V6 es LONG-only. El backtest mostro que en bear markets solo genera 4 trades — el capital esta inactivo. Agregar SHORT duplica las oportunidades de trading.

El usuario opera tanto en spot como en futuros, por lo que las senales SHORT sirven tanto para cerrar LONGs abiertos como para abrir posiciones cortas.

## Solucion

La senal SHORT es el espejo exacto de la LONG. Una sola funcion `scan()` evalua ambas direcciones y retorna la que aplique.

### Condiciones de Entrada

| Condicion | LONG | SHORT |
|-----------|------|-------|
| Zona LRC 1H | LRC% <= 25 (cuartil inferior) | LRC% >= 75 (cuartil superior) |
| Macro 4H | Precio > SMA100 (tendencia alcista) | Precio < SMA100 (tendencia bajista) |
| Gatillo 5M | Vela alcista + RSI recuperando | Vela bajista + RSI cayendo |
| E1 Exclusion | Bull engulfing | Bear engulfing (nueva funcion) |
| E6 Exclusion | Divergencia bajista RSI | Divergencia alcista RSI |

Si LRC esta entre 25% y 75%, no hay senal en ninguna direccion.

### Score SHORT (C1-C7 invertidos)

| Confirmacion | Pts | LONG | SHORT |
|-------------|-----|------|-------|
| C1 | 2 | RSI < 40 | RSI > 60 |
| C2 | 2 | Divergencia alcista RSI | Divergencia bajista RSI |
| C3 | 1 | Cerca de soporte (LRC lower ≤1.5%) | Cerca de resistencia (LRC upper ≤1.5%) |
| C4 | 1 | Debajo de BB lower | Encima de BB upper |
| C5 | 1 | Volumen alto | Volumen alto (igual) |
| C6 | 1 | CVD positivo | CVD negativo |
| C7 | 1 | SMA10 > SMA20 | SMA10 < SMA20 |

### Gestion de Riesgo SHORT

| Parametro | LONG | SHORT |
|-----------|------|-------|
| SL | Entry - 1.0x ATR | Entry + 1.0x ATR |
| TP | Entry + 4.0x ATR | Entry - 4.0x ATR |
| Breakeven | Precio sube >= 1.5x ATR → SL a entry | Precio baja >= 1.5x ATR → SL a entry |
| Sizing | Igual (por score tier) | Igual (por score tier) |

## Cambios por Componente

### 1. Scanner (`btc_scanner.py`)

**Nueva constante:** `LRC_SHORT_MIN = 75.0` (zona SHORT = cuartil superior)

**Nueva funcion:** `detect_bear_engulfing(df)` — espejo de `detect_bull_engulfing`

**Nueva funcion:** `check_trigger_5m_short(df5)` — vela bajista + RSI cayendo

**Modificar `scan()`:**
- Evaluar zona LONG (LRC <= 25) y zona SHORT (LRC >= 75)
- Si zona SHORT: aplicar macro invertido, exclusiones invertidas, score invertido
- Reporte incluye `"direction": "LONG" | "SHORT" | null`
- `sizing_1h` calcula SL arriba y TP abajo para SHORT
- Estados: "SENAL LONG + GATILLO" / "SENAL SHORT + GATILLO" / etc.

### 2. API (`btc_api.py`)

Cambios minimos (ya soporta SHORT):
- `build_telegram_message()`: tomar direction del reporte, header "SENAL SHORT" con emoji rojo
- `execute_scan_for_symbol()`: pasar direction en payload
- Donde dice hardcodeado "SENAL LONG" o `"direction": "LONG"`, usar el valor del reporte

### 3. Frontend

**`SymbolCard.tsx`:** Badge condicional — verde "SENAL LONG" / rojo "SENAL SHORT"

**`SignalsTable.tsx`:** Nueva columna compacta "Dir" con pill "L" verde o "S" rojo

**`ChartModal.tsx`:** Chip de direction junto a Score/ATR

**`PositionsPanel.tsx`:** Ya soporta SHORT (barra SL→TP se invierte). Pill de color rojo para SHORT.

**`types.ts`:** Agregar `direction?: 'LONG' | 'SHORT' | null` a `SymbolStatus` y `Signal`

### 4. Backtest (`backtest.py`)

- Evaluar ambas direcciones en cada barra
- SHORT: SL arriba, TP abajo, trailing invertido
- Una posicion a la vez
- Reporte con breakdown LONG vs SHORT

### 5. Tests

- `test_scan_short_signal`: LRC >= 75% + macro bajista genera SHORT
- `test_scan_no_signal_midzone`: LRC 25-75% no genera senal
- `test_short_sl_above_entry`: SL de SHORT > entry price
- `test_short_tp_below_entry`: TP de SHORT < entry price
- `test_check_trigger_5m_bearish`: vela bajista + RSI cayendo
- `test_detect_bear_engulfing`: patron de engulfing bajista

## Que NO Cambia

- LRC, RSI, BB, SMA, ATR — indicadores existentes intactos
- DB schema — positions ya tiene direction
- Config — no se agregan parametros nuevos
- Cooldown — 6h entre trades (aplica a ambas direcciones)
