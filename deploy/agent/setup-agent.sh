#!/usr/bin/env bash
set -euo pipefail

HOST="${HOST:-root@72.56.29.233}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HERE="$ROOT/deploy/agent"

ssh "$HOST" 'set -e
export DEBIAN_FRONTEND=noninteractive
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap -q /swapfile && swapon /swapfile
  grep -q /swapfile /etc/fstab || echo "/swapfile none swap sw 0 0" >> /etc/fstab
fi
apt-get update -qq && apt-get install -y -qq docker.io docker-compose-v2
printf "{ \"log-driver\": \"json-file\", \"log-opts\": { \"max-size\": \"10m\", \"max-file\": \"5\" } }\n" > /etc/docker/daemon.json
systemctl enable --now docker && systemctl restart docker
id agent >/dev/null 2>&1 || useradd -m -s /bin/bash agent
install -d -m 700 -o agent -g agent /home/agent/.hermes /home/agent/.hermes/memories /home/agent/.hermes/skills
install -d -m 755 /opt/hermes
printf "AGENT_UID=%s\nAGENT_GID=%s\n" "$(id -u agent)" "$(id -g agent)" > /opt/hermes/.env'

scp -q "$HERE/compose.yaml" "$HOST:/opt/hermes/compose.yaml"
scp -q "$HERE/agent-firewall.sh" "$HOST:/usr/local/sbin/agent-firewall.sh"
scp -q "$HERE/agent-firewall.service" "$HOST:/etc/systemd/system/agent-firewall.service"
scp -q "$HERE/nginx-agent.conf" "$HOST:/etc/nginx/sites-available/agent.tmp"

for f in USER.md MEMORY.md; do
  ssh "$HOST" "test -f /home/agent/.hermes/memories/$f" || scp -q "$ROOT/agent-lab/server/memories/$f" "$HOST:/home/agent/.hermes/memories/$f"
done
ssh "$HOST" 'test -d /home/agent/.hermes/skills/source-digest' || scp -qr "$ROOT/agent-lab/server/skills/source-digest" "$HOST:/home/agent/.hermes/skills/"

ssh "$HOST" 'set -e
chown -R agent:agent /home/agent/.hermes
chmod 755 /usr/local/sbin/agent-firewall.sh
cd /opt/hermes && docker compose pull -q && docker compose create
systemctl daemon-reload && systemctl enable --now agent-firewall
systemctl restart agent-firewall
if [ -f /etc/nginx/sites-available/agent ]; then rm /etc/nginx/sites-available/agent.tmp
else mv /etc/nginx/sites-available/agent.tmp /etc/nginx/sites-available/agent; fi
ln -sf /etc/nginx/sites-available/agent /etc/nginx/sites-enabled/agent
nginx -t && systemctl reload nginx'

echo "Готово. Дальше: /home/agent/.hermes/.env (ключи), config.yaml, затем: cd /opt/hermes && docker compose up -d"
