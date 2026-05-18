#!/usr/bin/env bash
# bootstrap-atomic-deploy.sh — migración al layout atómico (v2, simplificado).
#
# Diseño:
#
#   /var/www/trading/
#   ├── current → releases/<sha>     (atomic symlink)
#   ├── releases/<sha>/
#   │   ├── btc_api.py / código       (movido del root)
#   │   ├── .env  → ../../.env        (symlink al .env del root)
#   │   ├── .venv → ../../.venv       (symlink al .venv del root)
#   │   └── data  → ../../data        (symlink al data del root)
#   ├── .env                           (NO se mueve)
#   ├── .venv/                         (NO se mueve — shebangs siguen válidos)
#   └── data/                          (NO se mueve — DB queda en path original)
#
# Trade-off conocido: .venv es shared entre releases. Si requirements.txt
# cambia entre deploys, el OLD release puede romperse hasta el cutover.
# Aceptable para single-dev sin capital real.
#
# El único cambio al systemd unit es WorkingDirectory:
#   WorkingDirectory=/var/www/trading → /var/www/trading/current
# ExecStart, EnvironmentFile, ReadWritePaths quedan IGUALES.
#
# Idempotente: si /var/www/trading/current ya existe, sale sin hacer nada.
#
# Flags:
#   --dry-run   Preview sin destruir. Implica --yes.
#   --yes       Skip prompt interactivo después del diff del unit.
#   --sha=<id>  ID para el release inicial (default pre-atomic-<ts>).

set -euo pipefail

# ── Parse flags ──────────────────────────────────────────────

DRY_RUN=0
ASSUME_YES=0
INITIAL_SHA=""

for arg in "$@"; do
  case "$arg" in
    --dry-run)  DRY_RUN=1; ASSUME_YES=1 ;;
    --yes)      ASSUME_YES=1 ;;
    --sha=*)    INITIAL_SHA="${arg#--sha=}" ;;
    -h|--help)
      sed -n '1,/^set -e/p' "$0" | sed 's/^# \?//' | head -n -1
      exit 0
      ;;
    *)
      echo "::error::Flag desconocido: $arg"
      echo "Usage: $0 [--dry-run] [--yes] [--sha=<id>]"
      exit 2
      ;;
  esac
done

if [ -z "$INITIAL_SHA" ]; then
  INITIAL_SHA="pre-atomic-$(date +%Y%m%d-%H%M%S)"
fi

BASE=/var/www/trading
UNIT=/etc/systemd/system/trading-spacial.service

run() {
  if [ "$DRY_RUN" = "1" ]; then
    echo "  [dry-run] would run: $*"
  else
    "$@"
  fi
}

# ── 0. Sanity checks ─────────────────────────────────────────

echo "==> Bootstrap atómico (v2 simplificado)"
echo "    BASE         = $BASE"
echo "    INITIAL_SHA  = $INITIAL_SHA"
echo "    DRY_RUN      = $DRY_RUN"
echo

if [ ! -d "$BASE" ]; then
  echo "::error::$BASE no existe"
  exit 1
fi

if [ -L "$BASE/current" ]; then
  echo "==> $BASE/current ya existe → $(readlink $BASE/current)"
  echo "==> Layout atómico ya bootstrapped. Saliendo."
  exit 0
fi

for f in .env .venv; do
  if [ ! -e "$BASE/$f" ]; then
    echo "::error::$BASE/$f no existe"
    exit 1
  fi
done

if [ ! -f "$UNIT" ]; then
  echo "::error::$UNIT no existe"
  exit 1
fi

echo "==> Sanity checks OK."
echo

# ── 1. Pausar service ────────────────────────────────────────

echo "==> Step 1: Pausar trading-spacial"
run sudo systemctl stop trading-spacial
echo

# ── 2. Crear releases/<initial-sha>/ ─────────────────────────

echo "==> Step 2: Crear $BASE/releases/$INITIAL_SHA/"
run sudo mkdir -p "$BASE/releases/$INITIAL_SHA"
echo

# ── 3. Mover código (todo excepto .env, .venv, data, releases, current) ──

echo "==> Step 3: Mover archivos de código a releases/$INITIAL_SHA/"
echo "          (excluye: .env, .venv, data, releases, current)"

cd "$BASE"

# bash `*` no incluye dotfiles por default. Agregamos los conocidos manualmente.
if [ "$DRY_RUN" = "1" ]; then
  echo "  [dry-run] would move these entries:"
  for f in * .[!.]*; do
    [ -e "$f" ] || continue
    case "$f" in
      .env|.venv|data|releases|current) ;;
      *) echo "    - $f" ;;
    esac
  done
else
  for f in * .[!.]*; do
    [ -e "$f" ] || continue
    case "$f" in
      .env|.venv|data|releases|current) ;;
      *) sudo mv "$f" "releases/$INITIAL_SHA/" ;;
    esac
  done
fi
echo

# ── 4. Symlinks dentro del release apuntando al root ─────────

echo "==> Step 4: Crear symlinks dentro del release (apuntan a root)"
run sudo ln -sfn ../../.env  "$BASE/releases/$INITIAL_SHA/.env"
run sudo ln -sfn ../../.venv "$BASE/releases/$INITIAL_SHA/.venv"
# data: solo si existe en root
if [ -d "$BASE/data" ]; then
  run sudo ln -sfn ../../data "$BASE/releases/$INITIAL_SHA/data"
fi
echo

# ── 5. Symlink current → release inicial ─────────────────────

echo "==> Step 5: Crear symlink $BASE/current → releases/$INITIAL_SHA"
run sudo ln -sfn "releases/$INITIAL_SHA" "$BASE/current"
echo

# ── 6. Actualizar systemd unit (1 sola línea) ────────────────

echo "==> Step 6: Actualizar systemd unit"
echo "    WorkingDirectory=/var/www/trading → /var/www/trading/current"
echo "    (ExecStart, EnvironmentFile, ReadWritePaths NO cambian)"
echo

ORIGINAL_UNIT=$(sudo cat "$UNIT")
NEW_UNIT=$(echo "$ORIGINAL_UNIT" | sed 's|^WorkingDirectory=/var/www/trading$|WorkingDirectory=/var/www/trading/current|')

echo "    Diff del systemd unit:"
echo "    ──────────────────────"
diff <(echo "$ORIGINAL_UNIT") <(echo "$NEW_UNIT") | sed 's/^/    /' || true
echo "    ──────────────────────"
echo

if [ "$DRY_RUN" = "1" ]; then
  echo "  [dry-run] would backup unit + write new + daemon-reload"
else
  BAK="${UNIT}.bak.$(date +%s)"
  echo "==> Backup del unit en $BAK"
  sudo cp "$UNIT" "$BAK"

  if [ "$ASSUME_YES" = "0" ]; then
    echo "==> ¿OK el diff de arriba? Enter para aplicar · Ctrl+C para abortar."
    read -r _
  fi

  echo "==> Reescribiendo $UNIT"
  echo "$NEW_UNIT" | sudo tee "$UNIT" > /dev/null

  echo "==> systemctl daemon-reload"
  sudo systemctl daemon-reload
fi
echo

# ── 7. Restart + health check ────────────────────────────────

echo "==> Step 7: Arrancar trading-spacial"
run sudo systemctl start trading-spacial

if [ "$DRY_RUN" = "1" ]; then
  echo "  [dry-run] would wait 8s then curl http://localhost:8100/health"
  echo
  echo "==> Dry-run completado. Para aplicar: $0 --yes"
  exit 0
fi

echo "==> Esperando 8s y verificando health..."
sleep 8

if curl -fsS http://localhost:8100/health > /dev/null; then
  echo
  echo "==> ✓ Bootstrap completado."
  echo "==> Release activo: $INITIAL_SHA"
  echo "==> Layout final:"
  echo "      current  → $(readlink $BASE/current)"
  echo "      .env     → $(ls -lad $BASE/.env  2>/dev/null | awk '{print $1, $NF}')"
  echo "      .venv    → $(ls -lad $BASE/.venv 2>/dev/null | awk '{print $1, $NF}')"
  echo "      data     → $(ls -lad $BASE/data  2>/dev/null | awk '{print $1, $NF}')"
else
  echo "::error::Health check falló."
  echo "::error::Logs:"
  sudo journalctl -u trading-spacial -n 60 --no-pager
  echo
  echo "::error::Para rollback automático: gh workflow run \"Bootstrap atomic deploy\" -f mode=rollback"
  exit 1
fi
