"""EmailChannel tests — SMTP send via smtplib, with TLS + auth + error handling."""
import smtplib
from unittest.mock import patch, MagicMock

import pytest


def _cfg(**overrides):
    base = {
        "notifier": {
            "channels": {
                "email": {
                    "enabled": True,
                    "smtp_host": "smtp.example.com",
                    "smtp_port": 587,
                    "use_tls": True,
                    "username": "alerts@example.com",
                    "password": "pw",
                    "from_addr": "alerts@example.com",
                    "to_addrs": ["operator@example.com"],
                },
            },
        },
    }
    base["notifier"]["channels"]["email"].update(overrides)
    return base


def test_email_disabled_returns_failed():
    from notifier.channels.email import EmailChannel
    ch = EmailChannel(_cfg(enabled=False))
    receipt = ch.send("body", event_type="signal", event_key="sig:BTC")
    assert receipt.status == "failed"
    assert "disabled" in receipt.error.lower()


def test_email_missing_host_returns_failed():
    from notifier.channels.email import EmailChannel
    ch = EmailChannel(_cfg(smtp_host=""))
    receipt = ch.send("body")
    assert receipt.status == "failed"
    assert "not configured" in receipt.error.lower()


def test_email_missing_to_addrs_returns_failed():
    from notifier.channels.email import EmailChannel
    ch = EmailChannel(_cfg(to_addrs=[]))
    receipt = ch.send("body")
    assert receipt.status == "failed"
    assert "not configured" in receipt.error.lower()


def test_email_send_success():
    from notifier.channels.email import EmailChannel
    ch = EmailChannel(_cfg())

    fake_smtp = MagicMock()
    fake_smtp.__enter__ = MagicMock(return_value=fake_smtp)
    fake_smtp.__exit__ = MagicMock(return_value=False)

    with patch("notifier.channels.email.smtplib.SMTP", return_value=fake_smtp) as ctor, \
         patch("notifier.channels.email.ssl.create_default_context"):
        receipt = ch.send("Hello world", event_type="signal", event_key="sig:BTC")

    assert receipt.status == "ok"
    ctor.assert_called_once_with("smtp.example.com", 587, timeout=15)
    fake_smtp.starttls.assert_called_once()
    fake_smtp.login.assert_called_once_with("alerts@example.com", "pw")
    fake_smtp.sendmail.assert_called_once()
    args, _ = fake_smtp.sendmail.call_args
    # from_addr, [to_addrs], message_body (MIME-encoded, may base64 the body)
    assert args[0] == "alerts@example.com"
    assert args[1] == ["operator@example.com"]
    assert "[signal] sig:BTC" in args[2]  # Subject is not encoded
    # Body is base64 on MIMEText text/plain in some versions — decode to check.
    import base64
    body_line = args[2].split("\n\n", 1)[-1].strip()
    try:
        decoded = base64.b64decode(body_line).decode("utf-8")
    except Exception:
        decoded = body_line
    assert "Hello world" in decoded


def test_email_auth_failure_returns_failed():
    from notifier.channels.email import EmailChannel
    ch = EmailChannel(_cfg())

    fake_smtp = MagicMock()
    fake_smtp.__enter__ = MagicMock(return_value=fake_smtp)
    fake_smtp.__exit__ = MagicMock(return_value=False)
    fake_smtp.login.side_effect = smtplib.SMTPAuthenticationError(535, b"auth failed")

    with patch("notifier.channels.email.smtplib.SMTP", return_value=fake_smtp), \
         patch("notifier.channels.email.ssl.create_default_context"):
        receipt = ch.send("body", event_type="signal")

    assert receipt.status == "failed"
    assert "auth" in receipt.error.lower()


def test_email_network_failure_returns_failed():
    from notifier.channels.email import EmailChannel
    ch = EmailChannel(_cfg())

    with patch("notifier.channels.email.smtplib.SMTP",
                side_effect=OSError("connection refused")):
        receipt = ch.send("body")

    assert receipt.status == "failed"
    assert "connection" in receipt.error.lower()


def test_email_to_addrs_accepts_single_string():
    """If to_addrs is a bare string in config, it should be wrapped into a list."""
    from notifier.channels.email import EmailChannel
    cfg = _cfg()
    cfg["notifier"]["channels"]["email"]["to_addrs"] = "only@example.com"
    ch = EmailChannel(cfg)
    assert ch._to_addrs == ["only@example.com"]


def test_email_use_tls_false_skips_starttls():
    from notifier.channels.email import EmailChannel
    ch = EmailChannel(_cfg(use_tls=False))

    fake_smtp = MagicMock()
    fake_smtp.__enter__ = MagicMock(return_value=fake_smtp)
    fake_smtp.__exit__ = MagicMock(return_value=False)

    with patch("notifier.channels.email.smtplib.SMTP", return_value=fake_smtp):
        receipt = ch.send("body")

    assert receipt.status == "ok"
    fake_smtp.starttls.assert_not_called()
