"""SMTP email channel — send notification emails via a configured SMTP server.

Config shape (cfg["notifier"]["channels"]["email"]):
    {
        "enabled": true,
        "smtp_host": "smtp.gmail.com",
        "smtp_port": 587,
        "use_tls": true,
        "username": "alerts@example.com",
        "password": "app-password",
        "from_addr": "alerts@example.com",
        "to_addrs": ["operator@example.com"]
    }

The rendered template for <event>.email.j2 is treated as the message body.
Subject is derived from the event type + key (e.g. "[health] BTC PAUSED").
"""
from __future__ import annotations

import logging
import smtplib
import ssl
from email.mime.text import MIMEText
from typing import Any

from notifier.channels.base import Channel, DeliveryReceipt


log = logging.getLogger("notifier.email")


def _subject_for(event_type: str, event_key: str) -> str:
    return f"[{event_type}] {event_key}"


class EmailChannel(Channel):
    name = "email"

    def __init__(self, cfg: dict[str, Any]):
        notif_cfg = (cfg.get("notifier") or {})
        ch_cfg = ((notif_cfg.get("channels") or {}).get("email") or {})
        self._enabled: bool = bool(ch_cfg.get("enabled", False))
        self._host: str = (ch_cfg.get("smtp_host") or "").strip()
        self._port: int = int(ch_cfg.get("smtp_port") or 587)
        self._use_tls: bool = bool(ch_cfg.get("use_tls", True))
        self._username: str = (ch_cfg.get("username") or "").strip()
        self._password: str = ch_cfg.get("password") or ""
        self._from_addr: str = (ch_cfg.get("from_addr") or self._username).strip()
        to = ch_cfg.get("to_addrs") or []
        if isinstance(to, str):
            to = [to]
        self._to_addrs: list[str] = [str(a).strip() for a in to if str(a).strip()]

    def send(self, message: str, event_type: str = "", event_key: str = "") -> DeliveryReceipt:
        if not self._enabled:
            return DeliveryReceipt(channel=self.name, status="failed",
                                    error="email channel disabled in config")
        if not self._host or not self._from_addr or not self._to_addrs:
            return DeliveryReceipt(
                channel=self.name, status="failed",
                error="email not configured (missing smtp_host, from_addr, or to_addrs)",
            )

        msg = MIMEText(message, "plain", "utf-8")
        msg["Subject"] = _subject_for(event_type or "notification", event_key or "")
        msg["From"] = self._from_addr
        msg["To"] = ", ".join(self._to_addrs)

        try:
            context = ssl.create_default_context() if self._use_tls else None
            with smtplib.SMTP(self._host, self._port, timeout=15) as server:
                server.ehlo()
                if self._use_tls:
                    server.starttls(context=context)
                    server.ehlo()
                if self._username and self._password:
                    server.login(self._username, self._password)
                server.sendmail(self._from_addr, self._to_addrs, msg.as_string())
        except smtplib.SMTPAuthenticationError as e:
            err = f"SMTP auth failed: {e}"
            log.error("email send failed (auth): %s", err)
            return DeliveryReceipt(channel=self.name, status="failed", error=err)
        except smtplib.SMTPException as e:
            err = f"SMTP error: {type(e).__name__}: {e}"
            log.warning("email send failed: %s", err)
            return DeliveryReceipt(channel=self.name, status="failed", error=err)
        except OSError as e:
            err = f"SMTP connection error: {e}"
            log.warning("email send failed (network): %s", err)
            return DeliveryReceipt(channel=self.name, status="failed", error=err)

        return DeliveryReceipt(channel=self.name, status="ok")
