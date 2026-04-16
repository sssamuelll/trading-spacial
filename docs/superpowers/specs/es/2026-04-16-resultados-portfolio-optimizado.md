# Resultados del Portfolio Optimizado — De Perder a Ganar $54,706

**Fecha:** 16 de Abril 2026
**Autor:** Samuel Ballesteros
**Para:** Simon Ballesteros

---

## La Historia Completa en Numeros

| Escenario | Capital | Resultado | Retorno |
|-----------|---------|-----------|---------|
| 20 symbols, mismos parametros | $200,000 | **-$14,655** | -7.3% |
| Solo BTC | $10,000 | +$6,243 | +62.4% |
| **7 symbols, parametros individuales** | **$70,000** | **+$54,706** | **+78.2%** |

**Con la mitad del capital, ganamos 9 veces mas.**

---

## 1. Que Hicimos

Probamos 735 combinaciones de parametros (105 por cada uno de los 7 symbols seleccionados) para encontrar la configuracion optima de cada moneda. Cada prueba simulo 3+ anos de mercado real.

El proceso tomo 107 minutos de computo analizando mas de 7 millones de velas de datos historicos.

---

## 2. Los 7 Symbols del Portfolio Final

### Los Ganadores Grandes

| Symbol | Ganancia | Retorno | Win Rate | Trades | Por Que Funciona |
|--------|----------|---------|----------|--------|------------------|
| **DOGE** | **+$15,514** | +155% | 46.6% | 279 | Ciclos de pump/dump de redes sociales crean rebotes explosivos. SL tight (0.7x) captura los movimientos rapidos. |
| **ADA** | **+$14,718** | +147% | 30.4% | 286 | Oscila en rangos predecibles. SL muy tight (0.5x) con TP ambicioso (4x) captura los swings completos. |
| **BTC** | **+$10,654** | +107% | 21.5% | 326 | La referencia. Ciclos de mean-reversion limpios, rebotes fuertes desde soporte. |

### Los Ganadores Solidos

| Symbol | Ganancia | Retorno | Win Rate | Trades | Por Que Funciona |
|--------|----------|---------|----------|--------|------------------|
| **XLM** | +$5,863 | +59% | 43.6% | 225 | Rangea como ADA. SL tight (0.5x) funciona porque respeta soporte/resistencia. |
| **AVAX** | +$4,054 | +41% | 25.5% | 216 | Necesita SL amplio (1.5x) por su volatilidad, pero los rebounds son fuertes. |
| **UNI** | +$3,778 | +38% | 24.8% | 254 | Token DeFi que funciona con TP mas corto (3x en vez de 4x). |

### El Marginal

| Symbol | Ganancia | Retorno | Win Rate | Trades | Nota |
|--------|----------|---------|----------|--------|------|
| **ETH** | +$125 | +1% | 18.8% | 261 | Apenas rentable. Incluido por importancia del activo pero monitorear de cerca. |

---

## 3. Los Parametros Optimos

Cada moneda tiene su propia configuracion de Stop Loss y Take Profit, adaptada a su volatilidad:

| Symbol | Stop Loss | Take Profit | Breakeven | Que Significa |
|--------|-----------|-------------|-----------|---------------|
| BTC | 1.0x ATR | 4.0x ATR | 2.0x ATR | Parametros estandar |
| DOGE | 0.7x ATR | 4.0x ATR | 1.5x ATR | SL mas tight, BE rapido — captura pumps rapidos |
| XLM | 0.5x ATR | 4.0x ATR | 1.5x ATR | SL muy tight — rangea limpio |
| ADA | 0.5x ATR | 4.0x ATR | 2.0x ATR | SL tight, BE paciente — oscila en rangos amplios |
| AVAX | 1.5x ATR | 4.0x ATR | 2.0x ATR | SL amplio — volatilidad alta necesita espacio |
| ETH | 1.2x ATR | 4.0x ATR | 2.0x ATR | SL moderadamente amplio |
| UNI | 1.0x ATR | 3.0x ATR | 2.0x ATR | TP mas corto — movimientos DeFi son menores |

### El Patron Descubierto

- **TP = 4.0x ATR es universal** para casi todos los symbols (excepto UNI)
- **SL varia segun volatilidad:** baja volatilidad (ADA, XLM) → SL tight (0.5x). Alta volatilidad (AVAX) → SL amplio (1.5x)
- **BE = 2.0x es dominante** — dejar que los trades respiren antes de mover el stop a breakeven

---

## 4. Las 13 Monedas Eliminadas

Estas monedas se MONITOREAN pero NO se operan. No importa que parametros uses, pierden dinero con nuestra estrategia:

| Symbol | Mejor Resultado Posible | Por Que No Funciona |
|--------|------------------------|---------------------|
| SOL | -22% | Tendencias sostenidas, no rangea |
| BNB | -24% | Movimientos de exchange impredecibles |
| DOT | -36% | Declive estructural continuo |
| LINK | -40% | Volatilidad extrema sin patron |
| LTC | -49% | Activo muerto en declive |
| NEAR, APT, ARB, FIL, XRP, MATIC, ATOM, OP | Negativos | Diversos problemas estructurales |

**No es que sean malas monedas.** Es que nuestra estrategia (mean-reversion) no se ajusta a su comportamiento. Un sistema de trend-following podria funcionar en SOL o LINK, pero no es lo que hacemos.

---

## 5. Metricas del Portfolio

| Metrica | Valor |
|---------|-------|
| Capital total | $70,000 (7 × $10,000) |
| Ganancia neta | **+$54,706** |
| Retorno | **+78.2%** |
| Valor final | **$124,706** |
| Trades totales | 1,847 en 3 anos |
| Trades por mes | **~47** |
| Profit Factor promedio | 1.40 |

### Comparativa

| Escenario | Ganancia | Con $70k |
|-----------|----------|----------|
| Guardar en el banco (5% anual) | +$11,361 | $81,361 |
| S&P 500 promedio (10% anual) | +$23,177 | $93,177 |
| BTC buy & hold (2023-2026) | ~+$30,000 | ~$100,000 |
| **Nuestro portfolio optimizado** | **+$54,706** | **$124,706** |

---

## 6. Lo Que Aprendimos

### Leccion 1: Calidad sobre Cantidad
4 symbols cuidadosamente seleccionados generan el 85% de la ganancia. Agregar mas symbols sin optimizar destruye el resultado.

### Leccion 2: Cada Moneda es Diferente
No existe un parametro universal. ADA necesita un SL de 0.5x ATR. AVAX necesita 1.5x. Usar el mismo para ambas = perder dinero.

### Leccion 3: La Investigacion Paga
Antes de optimizar: -$14,655 (portfolio de 20 symbols)
Despues de investigar y optimizar: **+$54,706** (portfolio de 7 symbols)
Diferencia: **$69,361** — eso es lo que vale la investigacion.

### Leccion 4: Saber Cuando NO Operar
Eliminar 13 symbols no es una perdida. Es proteger $130,000 de capital que habria generado -$37,492 en perdidas.

---

## 7. Como Funciona Ahora el Sistema

El archivo `config.json` tiene una seccion `symbol_overrides` con los parametros de cada moneda:

```
Si el symbol esta en la lista con parametros → usa esos parametros
Si el symbol esta como "false"              → no opera (solo monitorea)
Si el symbol no esta en la lista            → usa parametros globales (BTC)
```

El sistema automaticamente aplica los parametros correctos a cada moneda. No hay que hacer nada manual.

---

## 8. Siguiente Paso

El sistema esta listo. Lo que falta es:

1. **Desplegar en produccion** con la nueva configuracion
2. **Monitorear 1 mes** para verificar que los resultados en vivo se acercan al backtest
3. **Re-evaluar trimestralmente** los parametros (el mercado cambia)

**La diferencia entre perder y ganar es: los parametros correctos para cada activo.**
