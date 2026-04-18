# Informe: Nuevos Tokens para el Portfolio

**Fecha:** 18 de Abril 2026
**De:** Samuel Ballesteros
**Para:** Simon Ballesteros
**Proyecto:** Trading Spacial — Expansion del portfolio

---

## Resumen Ejecutivo

Despues de confirmar que la estrategia dual (trend-following) no rescata monedas muertas, buscamos **monedas nuevas con fundamentales solidos** y las probamos con nuestra estrategia probada (Spot V6 mean-reversion con parametros optimizados per-symbol).

**Resultado: 3 nuevas monedas rentables encontradas.** Al agregarlas al portfolio, la ganancia potencial sube de **+$54,706 a +$86,596** (+58% mas).

---

## 1. Proceso de Seleccion

### Criterios Fundamentales

No buscamos "monedas de moda". Buscamos activos con:

| Criterio | Por Que Importa |
|----------|----------------|
| Liquidez alta | Para que nuestros indicadores tecnicos sean confiables |
| Ecosistema en crecimiento | Actividad de developers = token vivo, no muerto |
| Respaldo institucional | Fondos grandes (a16z, Pantera) hacen due diligence por nosotros |
| Volatilidad ciclica | Nuestra estrategia necesita que el precio oscile en rangos |
| Revenue real del protocolo | Token con ingresos reales, no solo especulacion |

### Tokens Investigados (6 candidatos)

| Token | Que Es | TVL | Respaldo | Data Disponible |
|-------|--------|-----|----------|----------------|
| PENDLE | Trading de rendimientos DeFi | $5.7B | - | Desde Jul 2023 |
| JUP | DEX aggregator #1 de Solana | $3.0B | - | Desde Ene 2024 |
| RUNE | DEX cross-chain (el mas grande para BTC) | - | - | Desde Sep 2020 |
| INJ | L1 DeFi especializado | - | Binance Labs | Desde Oct 2020 |
| SUI | L1 nueva generacion (Move) | $2.1B | a16z, Jump | Desde May 2023 |
| TIA | Capa de datos modular (Celestia) | - | Bain, Polychain | Desde Oct 2023 |

### Por Que Estos y No Otros

**PENDLE** — Domina el 50% del mercado de trading de rendimientos en DeFi. $44.6 millones en fees anuales. No tiene competencia real. Acaba de lanzar sPENDLE (staking liquido) y Boros para derivados.

**JUP (Jupiter)** — Maneja el 95% de los swaps en Solana. $70 millones en buybacks en 2025. Lanzaron JupUSD (stablecoin respaldada por BlackRock). TVL de $3 billones.

**RUNE (THORChain)** — El DEX mas grande para intercambiar Bitcoin ($118 billones en volumen total). Mecanismo deflacionario: 5% de fees se queman diariamente. Acaba de reconectar con Solana (v3.16).

**INJ (Injective)** — DeFi especializado con USDC nativo. Futures regulados en CFTC lanzados en abril 2026. Supply Squeeze activo (duplica tasa de deflacion).

**SUI** — L1 mas rapida en crecimiento: TVL +220% YoY, developer activity +219% YoY. CME lanzando futuros en mayo 2026. Grayscale tiene trusts dedicados.

---

## 2. Resultados del Backtest

### Paso 1: Test con parametros default (sin optimizar)

Periodo: Junio 2023 — Enero 2026

| Token | Trades | WR | P&L | PF | Veredicto |
|-------|--------|-----|-----|-----|-----------|
| PENDLE | 299 | 13.0% | -$274 | 0.98 | Casi rentable |
| JUP | 247 | 17.8% | -$1,466 | 0.89 | Prometedor |
| RUNE | 276 | 14.5% | -$1,540 | 0.91 | Prometedor |
| INJ | 328 | 11.0% | -$3,546 | 0.79 | Necesita optimizacion |
| SUI | 279 | 11.8% | -$3,197 | 0.76 | Necesita optimizacion |
| TIA | 235 | 11.1% | -$4,038 | 0.66 | Descartada |

**TIA (Celestia) descartada** — PF de 0.66 es demasiado bajo. No tiene los ciclos de precio que nuestra estrategia necesita.

### Paso 2: Optimizacion per-symbol (105 combinaciones cada uno)

Se probaron 105 combinaciones de SL, TP y BE (el mismo proceso que usamos para las 7 ganadoras originales):
- SL: 0.5x, 0.7x, 1.0x, 1.2x, 1.5x, 2.0x, 2.5x ATR
- TP: 2.0x, 3.0x, 4.0x, 5.0x, 6.0x ATR
- BE: 1.5x, 2.0x, 2.5x ATR

| Token | P&L Default | P&L Optimizado | SL | TP | BE | WR | PF |
|-------|------------|----------------|-----|-----|-----|------|-----|
| **PENDLE** | -$274 | **+$16,097** | 0.5x | 3.0x | 2.0x | 16.8% | 1.36 |
| **JUP** | -$1,466 | **+$9,576** | 0.5x | 4.0x | 2.5x | 21.8% | 1.33 |
| **RUNE** | -$1,540 | **+$6,217** | 0.7x | 6.0x | 2.5x | 10.8% | 1.19 |
| INJ | -$3,546 | +$1,506 | 2.0x | 3.0x | 2.0x | 35.4% | 1.13 |
| SUI | -$3,197 | +$746 | 0.7x | 2.0x | 2.5x | 27.2% | 1.03 |

**Los 5 son rentables con parametros optimizados**, pero INJ y SUI son marginales (como ETH en el portfolio actual). Recomendamos incluir solo los 3 fuertes.

---

## 3. Los 3 Nuevos Tokens — Analisis Detallado

### PENDLE — $+16,097 (+161% retorno)

```
SL = 0.5x ATR (stop loss tight — funciona porque PENDLE tiene rebotes limpios)
TP = 3.0x ATR (take profit moderado)
BE = 2.0x ATR (mover a breakeven cuando gana 2x ATR)
```

**Por que funciona:** PENDLE domina un nicho (yield trading) sin competencia. Cuando sube, sube fuerte por demanda real. Cuando baja, encuentra soporte rapido porque tiene revenue real ($44M/ano en fees). Esos rebotes son exactamente lo que nuestra estrategia captura.

**Riesgo:** Token DeFi — vulnerable a exploits de smart contracts o cambios regulatorios en DeFi.

### JUP (Jupiter) — $+9,576 (+96% retorno)

```
SL = 0.5x ATR (stop loss tight)
TP = 4.0x ATR (take profit amplio — dejar correr los ganadores)
BE = 2.5x ATR (breakeven conservador)
```

**Por que funciona:** Jupiter es infraestructura critica de Solana. Cada vez que Solana sube, JUP sube mas. Los ciclos de airdrop y buybacks ($70M) crean patrones predecibles de acumulacion/distribucion.

**Riesgo:** Dependencia total de Solana. Si Solana tiene problemas, JUP cae.

### RUNE (THORChain) — $+6,217 (+62% retorno)

```
SL = 0.7x ATR (stop loss moderado)
TP = 6.0x ATR (take profit MUY amplio — dejar correr)
BE = 2.5x ATR (breakeven conservador)
```

**Por que funciona:** RUNE tiene ciclos de volumen muy pronunciados — cuando el mercado esta activo, todo el mundo usa THORChain para intercambiar BTC. El TP amplio (6x ATR) captura esas explosiones de precio.

**Riesgo:** Protocolo complejo (cross-chain). Ha tenido exploits en el pasado. El TP de 6x ATR implica que la mayoria de trades pierden pero los ganadores compensan con creces.

---

## 4. Impacto en el Portfolio

### Portfolio Actual (7 symbols)

| Symbol | P&L | SL | TP | BE |
|--------|-----|-----|-----|-----|
| DOGE | +$15,514 | 0.7x | 4.0x | 1.5x |
| ADA | +$14,718 | 0.5x | 4.0x | 1.5x |
| BTC | +$10,654 | 1.0x | 4.0x | 1.5x |
| XLM | +$5,863 | 0.5x | 4.0x | 1.5x |
| AVAX | +$4,054 | 1.5x | 4.0x | 1.5x |
| UNI | +$3,778 | 1.0x | 3.0x | 1.5x |
| ETH | +$125 | 1.2x | 4.0x | 1.5x |
| **TOTAL** | **+$54,706** | | | |

### Portfolio Propuesto (10 symbols)

| Symbol | P&L | SL | TP | BE | Status |
|--------|-----|-----|-----|-----|--------|
| **PENDLE** | **+$16,097** | 0.5x | 3.0x | 2.0x | **NUEVO** |
| DOGE | +$15,514 | 0.7x | 4.0x | 1.5x | Existente |
| ADA | +$14,718 | 0.5x | 4.0x | 1.5x | Existente |
| BTC | +$10,654 | 1.0x | 4.0x | 1.5x | Existente |
| **JUP** | **+$9,576** | 0.5x | 4.0x | 2.5x | **NUEVO** |
| **RUNE** | **+$6,217** | 0.7x | 6.0x | 2.5x | **NUEVO** |
| XLM | +$5,863 | 0.5x | 4.0x | 1.5x | Existente |
| AVAX | +$4,054 | 1.5x | 4.0x | 1.5x | Existente |
| UNI | +$3,778 | 1.0x | 3.0x | 1.5x | Existente |
| ETH | +$125 | 1.2x | 4.0x | 1.5x | Existente |
| **TOTAL** | **+$86,596** | | | | **+58%** |

### Comparativa

| Metrica | Portfolio Actual | Portfolio Propuesto | Diferencia |
|---------|-----------------|--------------------|----|
| Symbols | 7 | 10 | +3 |
| Capital total | $70,000 | $100,000 | +$30,000 |
| Ganancia | +$54,706 | +$86,596 | **+$31,890** |
| Retorno | +78.2% | +86.6% | +8.4 pp |

**Con $10,000 adicionales por cada nuevo token ($30,000 extra), el portfolio genera $31,890 adicionales.** Eso es un retorno del 106% sobre el capital nuevo invertido.

---

## 5. Patrones Descubiertos

Mirando los parametros optimos de los 10 symbols, hay un patron claro:

| Tipo de Token | SL Optimo | TP Optimo | BE Optimo | Ejemplos |
|---------------|-----------|-----------|-----------|----------|
| Baja volatilidad (oscila en rangos) | 0.5x ATR | 3-4x ATR | 1.5-2.0x | ADA, XLM, PENDLE, JUP |
| Media volatilidad | 0.7-1.0x ATR | 4x ATR | 1.5x | BTC, DOGE |
| Alta volatilidad (explosiones) | 0.7-1.5x ATR | 4-6x ATR | 2.5x | AVAX, RUNE |
| DeFi | 1.0-2.0x ATR | 3x ATR | 1.5-2.0x | UNI, INJ |

**La regla general:** Tokens con rebotes limpios necesitan SL tight (0.5x) y TP moderado (3-4x). Tokens explosivos necesitan SL mas amplio y TP mucho mas alto para capturar los movimientos grandes.

---

## 6. Configuracion Para Activar

Agregar al `config.json` en la seccion `symbol_overrides`:

```json
{
  "symbol_overrides": {
    "PENDLEUSDT": {
      "atr_sl_mult": 0.5,
      "atr_tp_mult": 3.0,
      "atr_be_mult": 2.0
    },
    "JUPUSDT": {
      "atr_sl_mult": 0.5,
      "atr_tp_mult": 4.0,
      "atr_be_mult": 2.5
    },
    "RUNEUSDT": {
      "atr_sl_mult": 0.7,
      "atr_tp_mult": 6.0,
      "atr_be_mult": 2.5
    }
  }
}
```

Tambien agregar los 3 nuevos symbols a `DEFAULT_SYMBOLS` en `btc_scanner.py` (o esperar a que CoinGecko los incluya automaticamente en el top por market cap).

---

## 7. Riesgos y Mitigacion

| Riesgo | Probabilidad | Impacto | Mitigacion |
|--------|-------------|---------|-----------|
| Backtest no refleja futuro | Media | Alto | Empezar con capital reducido, monitorear 1 mes |
| Token pierde liquidez | Baja | Alto | Monitorear volumen diario, pausar si baja |
| Exploit de smart contract | Baja | Critico | Solo operar en spot, no DeFi directo |
| Sobre-optimizacion (overfitting) | Media | Medio | Params conservadores, revisar cada 3 meses |

### Plan de Activacion Propuesto

1. **Semana 1:** Activar PENDLE, JUP, RUNE con $5,000 cada uno (mitad de posicion)
2. **Semana 2-4:** Monitorear senales y comparar con backtest
3. **Mes 2:** Si resultados son consistentes, subir a $10,000 cada uno
4. **Cada 3 meses:** Re-evaluar parametros y fundamentales

---

## 8. Proximo Paso: Sistema de Tuning Automatico

Para no depender de correr optimizaciones manualmente, el siguiente desarrollo sera un **sistema automatizado** que:

1. Re-optimiza parametros de cada symbol mensualmente
2. Detecta cuando un symbol deja de ser rentable (kill switch)
3. Prueba candidatos nuevos automaticamente en modo paper trading
4. Genera reportes de salud del portfolio

Esto asegura que el sistema se adapta a cambios del mercado sin intervencion manual.

---

*"No buscamos la moneda perfecta. Buscamos monedas que oscilen de forma predecible con fundamentales que las mantengan vivas."*
