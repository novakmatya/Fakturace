#!/bin/bash
# Fakturace – spuštění na tomto Macu. Stačí dvojklik; bezpečné spouštět opakovaně
# (při prvním spuštění vše připraví, jinak jen ověří, že aplikace běží, a otevře ji).
set -euo pipefail
cd "$(dirname "$0")"

zprava() { osascript -e "display dialog \"$1\" with title \"Fakturace\" buttons {\"OK\"} default button 1" >/dev/null || true; }

# 1) Docker Desktop
if ! command -v docker >/dev/null 2>&1; then
  zprava "Nejdřív nainstalujte Docker Desktop (otevře se stránka ke stažení). Pak spusťte Fakturaci znovu."
  open "https://www.docker.com/products/docker-desktop/"
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "Spouštím Docker Desktop…"
  open -a Docker
  for _ in $(seq 1 90); do docker info >/dev/null 2>&1 && break; sleep 2; done
  docker info >/dev/null 2>&1 || { zprava "Docker Desktop se nespustil. Spusťte ho ručně a zkuste to znovu."; exit 1; }
fi

# 2) První spuštění: tajné klíče a složka pro zálohy
if [ ! -f .env ]; then
  ICLOUD="$HOME/Library/Mobile Documents/com~apple~CloudDocs"
  if [ -d "$ICLOUD" ]; then ZALOHY="$ICLOUD/Fakturace-zalohy"; else ZALOHY="$HOME/Documents/Fakturace-zalohy"; fi
  mkdir -p "$ZALOHY"
  SETUP_TOKEN="$(openssl rand -hex 8)"
  BACKUP_PASSWORD="$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24)"
  umask 077
  cat > .env <<ENV
# Fakturace – tajné hodnoty. Soubor nikomu neposílejte.
BETTER_AUTH_SECRET=$(openssl rand -base64 32)
SETUP_TOKEN=$SETUP_TOKEN
BACKUP_PASSWORD=$BACKUP_PASSWORD
ZALOHY_DIR=$ZALOHY
GMAIL_RELAY_SECRET=$(openssl rand -hex 24)
# Po propojení Gmailu (Nastavení → E-maily) doplňte a spusťte Fakturaci znovu:
# GMAIL_RELAY_URL=https://script.google.com/macros/s/.../exec
# MAIL_FROM=Jméno Příjmení <vas.ucet@gmail.com>
ENV
  zprava "Fakturace se připravuje poprvé (asi 5 minut).

Heslo k zálohám: $BACKUP_PASSWORD
Uložte si ho hned do aplikace Hesla – bez něj zálohu nikdo neotevře.

Instalační kód pro založení účtu: $SETUP_TOKEN
Zálohy: $ZALOHY"
fi

# 3) Sestavení (poprvé a po aktualizaci) a spuštění
echo "Spouštím Fakturaci…"
docker compose up -d --build
for _ in $(seq 1 60); do
  curl -fsS http://localhost:3000/api/zdravi >/dev/null 2>&1 && break
  sleep 2
done
open "http://localhost:3000"
