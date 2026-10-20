#!/usr/bin/env bash
# Сетевая изоляция контейнера агента (интерфейс br-agent) от остального сервера.
# Идемпотентно; запускается сервисом agent-firewall после docker.
set -euo pipefail

# Контейнер → сам хост: только сайт по 80/443, как у обычного посетителя.
# Закрыты Postgres (5432), API (3001), SSH, zabbix-agent и всё остальное.
iptables -N AGENT-IN 2>/dev/null || iptables -F AGENT-IN
iptables -A AGENT-IN -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -A AGENT-IN -p tcp -m multiport --dports 80,443 -j ACCEPT
iptables -A AGENT-IN -j DROP
iptables -C INPUT -i br-agent -j AGENT-IN 2>/dev/null || iptables -I INPUT 1 -i br-agent -j AGENT-IN

# Контейнер → наружу: всё, кроме метаданных облака и частных сетей.
iptables -N DOCKER-USER 2>/dev/null || true
for net in 169.254.0.0/16 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16; do
  iptables -C DOCKER-USER -i br-agent -d "$net" -j DROP 2>/dev/null || iptables -I DOCKER-USER -i br-agent -d "$net" -j DROP
done
