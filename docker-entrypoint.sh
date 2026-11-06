#!/bin/sh
# Start kontejneru: připraví datový adresář, aplikuje migrace a spustí server.
set -eu

DATA_DIR="${DATA_DIR:-/data}"
APP_USER="${APP_USER:-node}"

# Railway (a Docker volumes obecně) připojuje svazek jako root. Aplikace ale
# nemá běžet jako root: práva k datům se upraví a proces se znovu spustí
# pod neprivilegovaným uživatelem.
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  chown -R "$APP_USER:$APP_USER" "$DATA_DIR"
  if command -v setpriv >/dev/null 2>&1; then
    exec setpriv --reuid="$APP_USER" --regid="$APP_USER" --init-groups "$0" "$@"
  fi
  echo "Upozornění: setpriv není k dispozici, aplikace poběží jako root." >&2
fi

umask 077
node scripts/migrate.mjs
exec node server.js
