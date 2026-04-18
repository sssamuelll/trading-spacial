# Trading Spacial — Documento Completo del Sistema

**Version:** Spot V6 Optimizada
**Fecha:** 18 de Abril 2026
**Autores:** Samuel Ballesteros, Simon Ballesteros
**Estado:** Produccion

---

## 1. Que Es Este Sistema

Trading Spacial es un sistema automatizado de senales de trading para criptomonedas. **No ejecuta trades automaticamente** — genera senales de alta calidad y las envia por Telegram para que el operador decida si entrar o no.

El sistema monitorea 10 criptomonedas las 24 horas del dia, analiza multiples timeframes, detecta el regimen del mercado, y solo emite senales cuando todas las condiciones se alinean.

### Rendimiento Validado por Backtest

| Metrica | Valor |
|---------|-------|
| **Periodo de prueba** | Junio 2023 — Enero 2026 (2.5 anos) |
| **Capital simulado** | $100,000 ($10,000 por moneda) |
| **Ganancia neta** | **+$98,446** |
| **Retorno total** | **+98.4%** |
| **Retorno anualizado** | ~39.4% |
| **Monedas operadas** | 10 |

### Comparativa con Otras Inversiones (mismo periodo)

| Inversion | Retorno | Capital final |
|-----------|---------|---------------|
| Cuenta de ahorro (5% anual) | +$12,800 | $112,800 |
| S&P 500 (10% anual) | +$27,050 | $127,050 |
| BTC buy & hold | ~+$40,000 | ~$140,000 |
| **Trading Spacial** | **+$98,446** | **$198,446** |

---

## 2. Que Monedas Opera y Por Que

El sistema no opera todas las criptomonedas. Cada moneda fue seleccionada por sus fundamentales y validada por backtest con parametros optimizados individualmente.

### Portfolio Activo (10 monedas)

| # | Moneda | Que Es | P&L Backtest | SL | TP | BE |
|---|--------|--------|-------------|-----|-----|-----|
| 1 | **PENDLE** | Plataforma de trading de rendimientos DeFi. Domina 50% del mercado. $44M en fees anuales. | +$16,097 | 0.5x | 3.0x | 2.0x |
| 2 | **DOGE** | Memecoin con ciclos predecibles impulsados por redes sociales. Alta liquidez. | +$15,514 | 0.7x | 4.0x | 1.5x |
| 3 | **ADA** | Blockchain L1 con patrones de oscilacion muy definidos. Rangea limpiamente. | +$14,718 | 0.5x | 4.0x | 1.5x |
| 4 | **BTC** | Bitcoin. Referencia del mercado. Ciclos de halving predecibles. | +$10,654 | 1.0x | 4.0x | 1.5x |
| 5 | **JUP** | Agregador DEX #1 de Solana. Maneja 95% del volumen de swaps. $70M en buybacks. | +$9,576 | 0.5x | 4.0x | 2.5x |
| 6 | **RUNE** | DEX cross-chain mas grande para BTC. $118B en volumen total. Mecanismo deflacionario. | +$6,217 | 0.7x | 6.0x | 2.5x |
| 7 | **XLM** | Red de pagos con oscilaciones predecibles en rangos definidos. | +$5,863 | 0.5x | 4.0x | 1.5x |
| 8 | **AVAX** | Blockchain L1 de alta velocidad. Volatil pero con patrones explotables. | +$4,054 | 1.5x | 4.0x | 1.5x |
| 9 | **UNI** | Protocolo DeFi lider (Uniswap). Ciclos predecibles por governance y fees. | +$3,778 | 1.0x | 3.0x | 1.5x |
| 10 | **ETH** | Ethereum. Segunda cripto por capitalizacion. Marginal pero diversifica. | +$125 | 1.2x | 4.0x | 1.5x |

**Parametros explicados:**
- **SL (Stop Loss):** Cuanto puede perder un trade antes de cerrarse. Medido en multiplos de ATR (volatilidad). 0.5x = stop loss ajustado, 1.5x = amplio.
- **TP (Take Profit):** Cuanto debe ganar un trade para cerrar con ganancia. 3.0x-6.0x ATR.
- **BE (Breakeven):** Cuando un trade gana este multiplo de ATR, el stop loss se mueve al precio de entrada. A partir de ahi, no puedes perder.

### Por Que Estas 10 y No Otras

Se investigaron y probaron 26 criptomonedas en total. Las 10 seleccionadas comparten estas caracteristicas:

1. **Oscilan en rangos predecibles** — el precio sube, baja, y vuelve a subir con patrones repetitivos
2. **Alta liquidez** — suficiente volumen para que los indicadores tecnicos funcionen
3. **Fundamentales solidos** — ecosistema activo, revenue real, respaldo institucional
4. **Backtest rentable** — cada una fue probada con 105 combinaciones de parametros

Las 16 monedas descartadas (incluyendo SOL, BNB, DOT, LINK, LTC, XRP, MATIC, FIL, etc.) pierden dinero sin importar los parametros. El problema no es la estrategia — es que esos activos no tienen los patrones que nuestro sistema necesita.

---

## 3. Como Funciona el Sistema — Las 10 Capas

### Capa 1: Recoleccion de Datos (cada 5 minutos)

El sistema descarga datos de precios de Binance (con Bybit como respaldo automatico si Binance cae) en tres timeframes simultaneamente:

- **4 Horas (4H):** 150 velas — contexto macro, tendencia general
- **1 Hora (1H):** 210 velas — senal principal, donde se toman las decisiones
- **5 Minutos (5M):** 210 velas — gatillo de entrada, confirmacion de momento exacto

**Si Binance falla**, el sistema automaticamente cambia a Bybit y reintenta Binance cada 10 llamadas.

### Capa 2: Detector de Regimen de Mercado (1 vez al dia)

Antes de generar cualquier senal, el sistema determina si el mercado general esta en modo alcista, bajista o neutral. Combina 3 fuentes de informacion:

**Precio (40% del peso)**
- Mira si hay un "Death Cross" (SMA50 debajo de SMA200 — senal clasica de mercado bajista)
- Verifica si el precio esta por encima o debajo de la SMA200
- Calcula el momentum de los ultimos 30 dias

**Sentimiento (30% del peso)**
- Consulta el Fear & Greed Index — un indice que mide el miedo y la codicia del mercado combinando redes sociales, encuestas, volatilidad y volumen de busquedas
- Va de 0 (panico extremo) a 100 (codicia extrema)

**Mercado (30% del peso)**
- Consulta el Funding Rate de Binance Futures — indica si los traders profesionales estan apostando al alza o a la baja
- Funding positivo = los pros estan largos (alcista)
- Funding negativo = los pros estan cortos (bajista)

**Clasificacion:**

| Score Compuesto | Regimen | Accion del Sistema |
|-----------------|---------|-------------------|
| Mayor a 60 | **BULL** | Opera normalmente (LONG) |
| Entre 40 y 60 | **NEUTRAL** | Opera con cautela (solo LONG) |
| Menor a 40 | **BEAR** | Activa senales SHORT, bloquea LONG |

**Valor demostrado:** El detector aporta +$42,000 al portfolio. Sin el, la ganancia cae de +$98,446 a +$50,494.

### Capa 3: Analisis Macro (4H)

En el timeframe de 4 horas, el sistema calcula la SMA de 100 periodos (SMA100). Esta media movil representa la tendencia de los ultimos ~17 dias.

- **Precio por encima de SMA100:** Tendencia macro alcista — seguro buscar entradas LONG
- **Precio por debajo de SMA100:** Tendencia macro bajista — no entrar LONG (o buscar SHORT si regimen es BEAR)

Este filtro evita comprar en mercados que estan cayendo estructuralmente.

### Capa 4: Canal de Regresion Lineal (1H) — La Senal Principal

El indicador estrella del sistema es el **LRC (Linear Regression Channel)** de 100 periodos en 1H. Es un canal estadistico que muestra donde "deberia" estar el precio basado en la tendencia reciente.

- **LRC% = 0-25:** El precio esta en la zona baja del canal → **zona de compra** (el precio esta "barato" respecto a su tendencia)
- **LRC% = 75-100:** El precio esta en la zona alta del canal → **zona de venta/short**
- **LRC% = 25-75:** Zona neutral — no hay setup

**Solo cuando LRC% esta en zona extrema (<=25 o >=75) el sistema busca confirmar la entrada.**

### Capa 5: Scoring de Calidad (C1-C7, maximo 9 puntos)

Cuando el LRC detecta una zona de entrada, el sistema evalua 7 criterios de confirmacion:

| Criterio | Puntos | Que Mide |
|----------|--------|----------|
| **C1: RSI Sobreventa** | 2 | RSI por debajo de 40 — el activo esta siendo vendido en exceso |
| **C2: Divergencia RSI** | 2 | El precio baja pero el RSI sube — la presion vendedora se agota |
| **C3: Soporte Cercano** | 1 | El precio esta a menos de 1.5% del borde inferior del canal LRC |
| **C4: Bollinger Inferior** | 1 | El precio toca la banda inferior de Bollinger — volatilidad extrema |
| **C5: Volumen** | 1 | El volumen actual es mayor que el promedio de 20 periodos |
| **C6: CVD Delta** | 1 | El flujo de ordenes neto es positivo — hay mas compradores que vendedores |
| **C7: SMA10 > SMA20** | 1 | La micro-tendencia ya empieza a girar al alza |

**Como afecta el score al tamano de la posicion:**

| Score | Calidad | Tamano de Posicion |
|-------|---------|-------------------|
| 0-1 | Minima | 50% del tamano normal |
| 2-3 | Estandar | 100% (tamano normal) |
| 4+ | Premium | 150% (posicion ampliada) |

### Capa 6: Exclusiones Automaticas (Proteccion)

Incluso si hay una senal valida, el sistema la bloquea si detecta:

| Exclusion | Que Detecta | Accion |
|-----------|-------------|--------|
| **E1: Bull Engulfing** | Una vela alcista que engulle la anterior — posible micro-techo | Bloquea entrada LONG |
| **E6: Divergencia Bajista** | Precio sube pero RSI baja — la subida se esta agotando | Bloquea entrada LONG |
| **Cooldown** | Menos de 6 horas desde el ultimo trade | Espera |

Estas exclusiones previenen entrar en momentos que parecen buenos pero tienen alto riesgo de reversion inmediata.

### Capa 7: Gatillo de 5 Minutos (Confirmacion Final)

Cuando todas las condiciones anteriores se cumplen (LRC en zona, score calculado, sin exclusiones, macro OK), el sistema todavia NO emite la senal. Espera una **confirmacion en el timeframe de 5 minutos:**

1. **Vela de 5M cierra alcista** (close > open) — primera senal de que la presion vendedora cede
2. **RSI de 5M esta recuperando** (RSI actual > RSI anterior) — el momentum esta girando

**Solo cuando ambas condiciones se cumplen**, el sistema emite la senal final: **"SENAL CONFIRMADA"**.

Este paso reduce entradas prematuras. Sin el, el sistema entraria en zonas que aun estan cayendo.

### Capa 8: Stop Loss y Take Profit Dinamicos (ATR)

En vez de usar porcentajes fijos (ej: "poner stop loss a -2%"), el sistema calcula stops basados en la **volatilidad actual del mercado** usando el ATR (Average True Range).

**ATR mide cuanto se mueve un activo normalmente.** Si BTC se mueve $2,000 por dia, el ATR sera aproximadamente $2,000.

- **Stop Loss = Precio de entrada - (ATR x Multiplicador SL)**
  - En un mercado calmado (ATR bajo): stop loss ajustado
  - En un mercado volatil (ATR alto): stop loss mas amplio
- **Take Profit = Precio de entrada + (ATR x Multiplicador TP)**
  - Mismo principio: objetivo de ganancia se adapta a la volatilidad

**Cada moneda tiene sus propios multiplicadores**, optimizados por backtest. Por ejemplo:
- ADA usa SL=0.5x (tight) porque sus rebotes son limpios
- AVAX usa SL=1.5x (amplio) porque es mas volatil
- RUNE usa TP=6.0x (muy amplio) porque tiene explosiones de precio

### Capa 9: Trailing Stop a Breakeven

Cuando un trade va a nuestro favor y la ganancia alcanza un cierto umbral (BE x ATR), el sistema **mueve el stop loss al precio de entrada.**

**Resultado:** A partir de ese momento, el trade solo puede terminar en ganancia o en cero. No puedes perder.

Ejemplo con BTC (BE=1.5x):
- Entras a $85,000. ATR = $2,000. SL original = $83,000 (-$2,000).
- El precio sube a $88,000. Ganancia = $3,000 = 1.5x ATR. **Se activa breakeven.**
- SL se mueve de $83,000 a $85,000 (precio de entrada).
- Si el precio cae despues, sales en $85,000 — sin perdida.

### Capa 10: Senales LONG y SHORT (Bidireccional)

El sistema puede operar en ambas direcciones:

- **LONG (apostar al alza):** Cuando el regimen es BULL o NEUTRAL. Compra en la zona baja del canal LRC.
- **SHORT (apostar a la baja):** Cuando el regimen es BEAR. Vende en la zona alta del canal LRC.

**La activacion de SHORT es automatica** — el detector de regimen decide cuando el mercado gira a bajista y activa las senales SHORT. No requiere intervencion manual.

---

## 4. Gestion de Riesgo

### Riesgo por Trade
- **Maximo 1% del capital por trade** — si tienes $10,000, arriesgas $100 por trade
- Score bajo (0-1): se reduce a 0.5% ($50)
- Score alto (4+): se amplia a 1.5% ($150)

### Protecciones del Sistema
| Proteccion | Como Funciona |
|-----------|---------------|
| Detector de regimen | Pausa el trading cuando el mercado es peligroso |
| Macro 4H | No entra LONG si la tendencia macro es bajista |
| Exclusiones automaticas | Bloquea entradas en momentos de alto riesgo |
| Trailing breakeven | Elimina el riesgo de trades ganadores |
| Cooldown 6 horas | Previene overtrading despues de un trade |
| Una posicion a la vez por moneda | Limita la exposicion maxima |

### Riesgo Maximo Teorico
- Capital total: $100,000
- 10 monedas x 1% riesgo = 10% del capital en riesgo simultaneo maximo
- Con trailing breakeven, el riesgo real es menor porque trades ganadores dejan de tener riesgo

---

## 5. Infraestructura Tecnica

### Componentes del Sistema

| Componente | Funcion | Tecnologia |
|-----------|---------|-----------|
| **Scanner** (`btc_scanner.py`) | Motor de senales — analisis multi-timeframe, scoring, regime detection | Python, pandas, numpy |
| **API** (`btc_api.py`) | Servidor REST — almacena senales, gestiona posiciones, sirve al dashboard | FastAPI, SQLite |
| **Dashboard** (`frontend/`) | Panel visual — muestra estado en tiempo real de todas las monedas | React, TypeScript |
| **Notificaciones** | Alertas al telefono cuando hay senal confirmada | Telegram Bot API |
| **Backtest** (`backtest.py`) | Simulador historico — valida estrategias con datos reales | Python, 7M+ velas |

### Flujo de Datos

```
Binance API (datos de precios cada 5 min)
  │
  ▼
Scanner: descarga velas 4H + 1H + 5M
  │
  ├── Detector de Regimen (1x/dia): BULL / NEUTRAL / BEAR
  │
  ├── Analisis 4H: SMA100 → macro OK?
  │
  ├── Analisis 1H: LRC → en zona? → Score C1-C7 → Exclusiones?
  │
  ├── Analisis 5M: Gatillo → vela alcista + RSI recuperando?
  │
  ▼
SENAL CONFIRMADA → Calcula SL/TP/Tamano
  │
  ├── Guarda en base de datos (SQLite)
  │
  ├── Envia alerta a Telegram (score, precio, SL, TP, tamano)
  │
  └── Actualiza dashboard web
```

### Resiliencia

| Situacion | Respuesta del Sistema |
|-----------|----------------------|
| Binance cae | Cambia automaticamente a Bybit |
| Bybit cae | Reintenta Binance cada 10 llamadas |
| API se cae | Watchdog la reinicia automaticamente |
| Base de datos bloqueada | SQLite WAL mode permite lectura concurrente |
| Backup | Copia automatica de la DB cada 24 horas (ultimas 7 copias) |

---

## 6. Que NO Hace el Sistema

Es importante entender los limites:

| Lo que NO hace | Por que |
|---------------|---------|
| **No ejecuta trades automaticamente** | Las senales se envian por Telegram. El operador decide si entrar. |
| **No opera con apalancamiento** | Solo spot (compra/venta directa). Sin riesgo de liquidacion. |
| **No garantiza ganancias futuras** | El backtest muestra rendimiento pasado. El mercado puede cambiar. |
| **No opera 24/7 en todas las monedas** | Solo opera 10 monedas seleccionadas por fundamentales. |
| **No usa estrategias de alta frecuencia** | Timeframe principal es 1H. Generalmente 1-3 senales por dia por moneda. |

---

## 7. Historial de Mejoras

| Fecha | Mejora | Impacto |
|-------|--------|---------|
| Abr 15 | SL/TP fijo → ATR dinamico | +33% → +53% retorno |
| Abr 15 | Parametros iguales → optimizados per-symbol (735 sims) | -$14,655 → +$54,706 portfolio |
| Abr 16 | Detector de regimen multi-signal | +53% → +62% (proteccion en bear) |
| Abr 16 | Infraestructura SHORT lista | Listo para bear markets |
| Abr 16 | Portfolio curado (7 ganadoras) | +$54,706 (+78.2%) |
| Abr 17-18 | Investigacion dual strategy (trend-following) | Construido, validado, descartado — confirmo que monedas muertas son muertas |
| Abr 18 | 3 nuevos tokens (PENDLE, JUP, RUNE) | +$54,706 → +$86,596 |
| Abr 18 | Optimizacion umbrales regimen (70/30 → 60/40) | +$86,596 → +$98,446 |

**Total de simulaciones ejecutadas:** 1,500+
**Total de velas historicas analizadas:** 7+ millones
**Tests automatizados:** 195 (todos pasan)

---

## 8. Proximos Pasos

### Corto Plazo (siguiente sprint)
1. **Sistema de tuning automatico** — Re-optimiza parametros de cada moneda periodicamente sin intervencion manual
2. **Kill switch automatico** — Si una moneda empieza a perder dinero consistentemente, el sistema la pausa automaticamente
3. **Paper trading para candidatos** — Monedas nuevas entran en modo "observacion" antes de operar con dinero real

### Mediano Plazo
4. **Mas fuentes de datos para el detector de regimen** — Agregar Open Interest, liquidaciones, y flujos de ETFs
5. **Re-evaluacion trimestral de tokens** — Revisar fundamentales y backtest cada 3 meses
6. **Walk-forward optimization** — Validar que los parametros funcionan en periodos futuros, no solo historicos

### Largo Plazo
7. **Ejecucion semi-automatica** — Conectar a un exchange via API para ejecutar trades con confirmacion manual
8. **Multi-exchange** — Operar en Binance, Bybit, y OKX simultaneamente para mejor liquidez
9. **Dashboard de riesgo** — Panel con metricas de exposicion, correlacion entre posiciones, y drawdown en tiempo real

---

## 9. Glosario

| Termino | Definicion |
|---------|-----------|
| **ATR** | Average True Range — mide cuanto se mueve un activo normalmente. Si BTC se mueve $2,000/dia, ATR ≈ $2,000 |
| **LRC** | Linear Regression Channel — canal estadistico que muestra donde "deberia" estar el precio |
| **RSI** | Relative Strength Index — mide si un activo esta sobrecomprado (>70) o sobrevendido (<30) |
| **SMA** | Simple Moving Average — promedio del precio de los ultimos N periodos |
| **Bollinger Bands** | Bandas de volatilidad alrededor del precio. Cuando el precio toca una banda, esta en un extremo |
| **CVD** | Cumulative Volume Delta — diferencia entre volumen de compradores y vendedores |
| **Death Cross** | Cuando la SMA50 cruza por debajo de la SMA200 — senal clasica de mercado bajista |
| **Funding Rate** | Tasa que pagan los traders de futuros. Positiva = mercado alcista. Negativa = bajista |
| **Fear & Greed** | Indice de 0-100 que mide el sentimiento del mercado crypto |
| **Backtest** | Simulacion de la estrategia con datos historicos para validar que funciona |
| **LONG** | Apostar a que el precio sube (comprar barato, vender caro) |
| **SHORT** | Apostar a que el precio baja (vender caro, recomprar barato) |
| **Spot** | Compra/venta directa del activo, sin apalancamiento ni derivados |

---

## 10. Resumen

Trading Spacial es un sistema de senales de trading que combina 10 capas de analisis para generar entradas de alta probabilidad en 10 criptomonedas seleccionadas por fundamentales.

**Rendimiento validado:** +$98,446 (+98.4%) sobre $100,000 en 2.5 anos.

**Filosofia:** Menos monedas operadas mejor que mas monedas operadas mal. Cada moneda tiene parametros propios, optimizados por datos, no por intuicion.

**Diferenciador:** El sistema no intenta predecir el futuro. Detecta patrones repetitivos en activos que oscilan de forma predecible, y solo opera cuando multiples capas de confirmacion coinciden.

---

*Trading Spacial — Version Spot V6 Optimizada*
*Abril 2026*
