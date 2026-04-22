# Notifier centralizado tipado — diseño

**Issue:** [#162](https://github.com/sssimon/trading-spacial/issues/162)
**Autor:** Samuel / Claude
**Fecha:** 2026-04-21
**Status:** aprobado, listo para planificar

## 1. Resumen

Reemplazar el sistema ad-hoc de notificaciones Telegram (`push_telegram_direct`, `build_telegram_message`, `_send_telegram_raw` en `btc_api.py`) por un notifier centralizado con eventos tipados, múltiples canales, dedupe, rate-limiting y templating.

Se divide en **3 PRs en serie**:

- **PR A — Notifier core:** refactor de Telegram al nuevo shape + dedupe + ratelimit + Jinja templates. Unblocks #138 Foundation.
- **PR B — Multi-channel:** `WebhookChannel` (POST JSON) + `EmailChannel` (SMTP).
- **PR C — Frontend notification center:** endpoint `/notifications` + `NotificationBell.tsx` + toasts al cargar el dashboard.

## 2. Motivación

El código de notificaciones hoy vive en `btc_api.py` (líneas 622, 1010, 1086, 1124, 1151, 1254, 1569, 1588, 1605, 1757) y está acoplado al flujo de signals. Cualquier feature nueva que necesite notificar (health events de #138, errores de infra, reportes) tiene que replicar el patrón. Ya se ve venir el problema con #138: 4 tiers (ALERT/REDUCED/PAUSED/REACTIVATED) cada uno con su propio `build_*_message` y su propio call site. Centralizar antes de que escale.

## 3. Scope

### Incluido

- Módulo `notifier/` con eventos tipados vía `@dataclass`:
  - `SignalEvent` — scan reports (lo que hoy usa Telegram)
  - `HealthEvent` — transiciones de kill switch (#138)
  - `InfraEvent` — errores del scanner/API
  - `SystemEvent` — restart, deploy, healthcheck
- Canales:
  - `TelegramChannel` (existing refactorizado)
  - `WebhookChannel` (POST JSON a URL arbitraria — sirve pa' n8n, Discord, Slack webhook endpoints)
  - `EmailChannel` (SMTP — útil pa' reportes diarios/semanales)
- Templates Jinja2 en `notifier/templates/*.j2`, uno por `(event_type, channel)` combo.
- Deduplicación DB-backed: ventana rolling configurable (default 30 min) por `(event_type, key)`.
- Rate limit: token-bucket por canal (default 20 req/min pa' Telegram).
- Frontend notification center:
  - Endpoint `GET /notifications?unread=true&limit=20`
  - Endpoint `POST /notifications/{id}/read`
  - Componente React `NotificationBell.tsx` con badge + dropdown
  - Toast al cargar el dashboard pa' eventos no leídos

### Fuera de scope

- WebSocket/SSE pa' realtime push al frontend — cubierto por issue #62, diseño lo contempla pero la implementación queda para después.
- Service workers / browser push notifications (permisos OS) — fricción alta, bajo ROI.
- Metrics de Prometheus del notifier — otro issue separado.
- UI pa' configurar channels desde el frontend — config manual en `config.json` por ahora.

## 4. Arquitectura

```
notifier/
├── __init__.py            # exporta notify(), event types
├── events.py              # @dataclass SignalEvent, HealthEvent, InfraEvent, SystemEvent
├── channels/
│   ├── base.py            # ABC Channel con send(event) -> DeliveryReceipt
│   ├── telegram.py        # TelegramChannel (refactor de push_telegram_direct)
│   ├── webhook.py         # WebhookChannel (POST JSON)
│   └── email.py           # EmailChannel (SMTP)
├── dedupe.py              # DB-backed sliding window
├── ratelimit.py           # token bucket per (channel, priority)
├── templates/             # Jinja2 templates
│   ├── signal.telegram.j2
│   ├── signal.webhook.j2
│   ├── health.telegram.j2
│   ├── infra.telegram.j2
│   └── system.email.j2    # reportes
└── _storage.py            # tablas notifications_sent + dedupe_log
```

### Tabla `notifications_sent`

```sql
CREATE TABLE notifications_sent (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type      TEXT    NOT NULL,       -- 'signal' | 'health' | 'infra' | 'system'
    event_key       TEXT    NOT NULL,       -- dedupe key (ej: 'BTCUSDT:PAUSED')
    priority        TEXT    NOT NULL,       -- 'info' | 'warning' | 'critical'
    payload_json    TEXT    NOT NULL,       -- serialized event dict
    channels_sent   TEXT    NOT NULL,       -- 'telegram,webhook'
    delivery_status TEXT    NOT NULL,       -- 'ok' | 'partial' | 'failed'
    sent_at         TEXT    NOT NULL,
    read_at         TEXT,                   -- para notification center del frontend
    error_log       TEXT
);

CREATE INDEX idx_notif_sent_unread
    ON notifications_sent(read_at) WHERE read_at IS NULL;
```

### Flujo

```
feature code
    │
    ▼
notify(event: Event)         <── API pública única
    │
    ├─► dedupe.should_send(event_type, event_key, window) ─[False]─► drop silently
    │                                                      ─[True]──┐
    │                                                                ▼
    ├─► ratelimit.acquire(channel)                              (for each channel in config)
    │                                                                │
    ├─► template.render(event, channel) → message                    │
    │                                                                │
    ├─► channel.send(message) → DeliveryReceipt                      │
    │                                                                │
    └─► storage.record(event, receipt) → notifications_sent
```

## 5. API pública

```python
from notifier import notify, SignalEvent, HealthEvent, InfraEvent

# Signal (refactor del path actual de scanner → telegram)
notify(SignalEvent(
    symbol="BTCUSDT",
    score=6,
    direction="LONG",
    entry=50_000,
    sl=49_000,
    tp=55_000,
))

# Health (lo que #138 necesita)
notify(HealthEvent(
    symbol="JUPUSDT",
    from_state="REDUCED",
    to_state="PAUSED",
    reason="3mo_consec_neg",
    metrics={"pnl_30d": -500, "months_negative": 3},
))

# Infra
notify(InfraEvent(
    component="scanner",
    severity="critical",
    message="scanner_loop died",
))
```

Cada event type tiene defaults razonables:
- `SignalEvent` → priority=info, channels=[telegram], dedupe_window=0 (no dedupe)
- `HealthEvent` → priority=warning, channels=[telegram, webhook], dedupe_window=30min
- `InfraEvent(severity='critical')` → priority=critical, channels=[telegram, email], dedupe_window=5min
- `SystemEvent` → priority=info, channels=[email], dedupe_window=0

Override por llamada:
```python
notify(event, channels_override=["webhook"], dedupe_window_override=timedelta(hours=1))
```

## 6. Config

```json
"notifier": {
  "enabled": true,
  "test_mode": false,
  "channels": {
    "telegram": {
      "enabled": true,
      "rate_limit_per_minute": 20
    },
    "webhook": {
      "enabled": true,
      "endpoints": [
        {"url": "http://localhost:5678/webhook/trading", "types": ["signal", "health"]}
      ]
    },
    "email": {
      "enabled": false,
      "smtp_host": "smtp.gmail.com",
      "smtp_port": 587,
      "from_addr": "",
      "to_addr": [],
      "types": ["system"]
    }
  },
  "dedupe": {
    "default_window_minutes": 30,
    "by_event_type": {
      "signal": 0,
      "health": 30,
      "infra": 5
    }
  }
}
```

Existing `webhook_url` y `telegram_*` keys se migran al bloque `channels.*` con backward-compat shim.

## 7. PR breakdown

### PR A — Notifier core (~2 días)

**Incluye:**
- `notifier/` module completo con `TelegramChannel` only
- Eventos: `SignalEvent`, `HealthEvent`, `InfraEvent`, `SystemEvent`
- Jinja2 templates para todos los events en Telegram
- Tabla `notifications_sent` (schema migration)
- Dedupe DB-backed
- Ratelimit token-bucket en Telegram
- Migración de los ~10 call sites actuales de `push_telegram_direct` / `_send_telegram_raw` a `notifier.notify(SignalEvent(...))`
- Snapshot test: mensajes Telegram post-refactor byte-identical a pre-refactor (paridad garantizada)
- Deprecation: `build_telegram_message` marcado `# deprecated, use notifier.notify`

**Fuera:** WebhookChannel, EmailChannel, frontend.

**Unblocks:** #138 Foundation, que usará `notify(HealthEvent(...))` limpio.

### PR B — Multi-channel (~1.5 días)

**Incluye:**
- `WebhookChannel` (POST JSON con retry + exponential backoff)
- `EmailChannel` (SMTP con TLS, config de server/auth)
- Templates Jinja2 `*.webhook.j2` y `*.email.j2` por event type
- Tests: webhook timeout, email auth failure, templates render sin vars ausentes
- Config: multiple webhook endpoints por event type, multiple email recipients

### PR C — Frontend notification center (~1.5 días)

**Incluye:**
- Backend: endpoints `GET /notifications?unread=true&limit=20`, `POST /notifications/{id}/read`, `POST /notifications/read-all`
- Frontend:
  - `NotificationBell.tsx` (ícono 🔔 + badge con count no leídos)
  - `NotificationDropdown.tsx` (list, mark as read, "view all")
  - `NotificationToast.tsx` (aparece al cargar el dashboard pa' eventos no leídos más críticos)
  - Integración en `App.tsx` del header existente
- Poll cada 30s al endpoint (alineado con el polling actual del dashboard)
- Comment en código apuntando a #62 pa' futuro upgrade a WebSocket/SSE sin cambio de API
- Tests: endpoints, toast aparece sólo 1× por evento, bell muestra count correcto

## 8. Testing

### PR A
- Cada event type: `notify(...)` produce registros correctos en `notifications_sent` + mensaje Telegram esperado (snapshot).
- Dedupe: 2 calls con mismo `(event_type, event_key)` en ventana < `dedupe_window` → solo 1 envío.
- Ratelimit: burst de 30 notify en 10s → ≤20 realmente enviados (el resto queued o dropped per policy).
- Migración: mensajes pre-refactor vs post-refactor byte-idénticos sobre fixtures de signals reales.
- test_mode=true: no hace HTTP requests, solo escribe a DB y log.

### PR B
- Webhook: payload JSON matches schema expected por n8n / Discord / generic.
- Webhook timeout: retry 3× con exponential backoff, fail al final.
- Email: SMTP auth failure retry, then fail gracefully + log.

### PR C
- Endpoint devuelve notifications ordenadas desc por `sent_at`.
- `POST /read` marca correctamente.
- Toast aparece solo para eventos con severity ≥ warning.
- Bell badge count update after mark-read.

## 9. Compatibilidad backward

- `config.json` keys legacy (`webhook_url`, `telegram_chat_id`, `telegram_bot_token`) siguen funcionando vía shim que las mapea al nuevo schema.
- `trading_webhook.py` sigue recibiendo payloads preformateados sin cambio (el scanner incluye `telegram_message` hasta que migración completa).
- `push_telegram_direct` y `_send_telegram_raw` marcadas deprecated pero NO borradas en PR A. Borrado en PR siguiente cuando todos los call sites estén migrados.

## 10. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Refactor rompe formato exacto de mensajes Telegram | Snapshot test byte-identity sobre fixtures reales |
| Dedupe bloquea notificaciones legítimas importantes | Priority `critical` bypassa dedupe por default |
| Rate limit corta notificaciones en burst (ej: 10 signals en 1 min) | Queue en lugar de drop; FIFO con capacity limit |
| Jinja2 agrega deps | Es una dep ligera (~200KB), ya la tenemos en un transitivo de FastAPI (starlette). Verificar antes; si no, agregarla a requirements |
| Frontend polling agrega carga | Poll cada 30s es leve, igual al polling actual. Notification endpoint con query optimizada (índice parcial) |
| Migración de call sites rompe algo invisible | Coverage de tests pre-refactor como baseline |

## 11. Métricas de éxito

- 1 punto de entrada único (`notifier.notify(event)`) usado por todo el código que notifica.
- 0 call sites directos a `push_telegram_direct` fuera del notifier después de PR A.
- `#138` Foundation usa `notify(HealthEvent(...))` limpio sin duplicar código de Telegram.
- Dedupe funcional demostrable: mismo event disparado 2× en <30min → 1 sola notificación.
- Snapshot test paridad: mensajes Telegram pre vs post refactor son byte-identicos.
- Frontend: usuario ve toast + bell badge al abrir dashboard si hay eventos.

## 12. Dependencias

- Precede obligatoriamente a #138 Foundation (según decisión del 2026-04-21).
- Toca `btc_api.py` (~10 call sites), `trading_webhook.py` (sin cambios funcionales), `frontend/src/` (PR C).
- Deps nuevas: Jinja2 (ya transitiva de Starlette/FastAPI — confirmar). SMTPlib (stdlib). Requests (ya usado).
