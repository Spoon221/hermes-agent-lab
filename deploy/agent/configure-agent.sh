#!/usr/bin/env bash
set -euo pipefail

HOST="${HOST:-root@72.56.29.233}"
: "${DOTPOIN_API_KEY:?Передайте DOTPOIN_API_KEY}"
TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
TELEGRAM_ALLOWED_USERS="${TELEGRAM_ALLOWED_USERS:-}"

if [ -n "$TELEGRAM_BOT_TOKEN" ] && ! [[ "$TELEGRAM_ALLOWED_USERS" =~ ^[0-9]+(,[0-9]+)*$ ]]; then
  echo "TELEGRAM_ALLOWED_USERS - числовой ID (или несколько через запятую). Режим «разрешить всем» не используется." >&2
  exit 1
fi

{
  printf 'DOTPOIN_API_KEY=%s\n' "$DOTPOIN_API_KEY"
  [ -n "$TELEGRAM_BOT_TOKEN" ] && printf 'TELEGRAM_BOT_TOKEN=%s\nTELEGRAM_ALLOWED_USERS=%s\n' "$TELEGRAM_BOT_TOKEN" "$TELEGRAM_ALLOWED_USERS"
  true
} | ssh "$HOST" 'install -m 600 -o agent -g agent /dev/null /home/agent/.hermes/.env.new && cat > /home/agent/.hermes/.env.new && mv /home/agent/.hermes/.env.new /home/agent/.hermes/.env'

ssh "$HOST" 'set -e
cd /opt/hermes
set_cfg() { docker compose run --rm -T hermes-agent config set "$1" "$2" >/dev/null; }
set_cfg model.provider custom
set_cfg model.default deepseek-v4-flash
set_cfg model.base_url https://llms.dotpoin.com/v1
set_cfg model.key_env DOTPOIN_API_KEY
set_cfg model.context_length 1048576
set_cfg skills.write_approval true
set_cfg display.memory_notifications on
echo "--- config.yaml (model)"; grep -A6 "^model:" /home/agent/.hermes/config.yaml || true
echo "--- проверка модели через CLI"
time docker compose run --rm -T hermes-agent -z "Ответь одним словом: работает" 2>&1 | tail -5
if grep -q "^TELEGRAM_BOT_TOKEN=" /home/agent/.hermes/.env; then
  docker compose up -d
  sleep 20
  docker compose logs --tail 40
fi'
