# hermes-agent-lab

Задание 2: агент для решения научных задач на собственном сервере ([Hermes Agent](https://hermes-agent.nousresearch.com/docs/)).
Отчёт: **https://agent.simakov.space/**

Выполнили: Симаков Евгений и Погоренко Иван, группа P4207.

## Что внутри

| Путь | Что это |
|---|---|
| `agent-lab/server/memories/` | память агента: `USER.md` (стиль, язык, формат), `MEMORY.md` (контекст исследования) |
| `agent-lab/server/skills/source-digest/` | свой навык: конспект источника по ссылке с цитатами |
| `deploy/agent/compose.yaml` | контейнер `nousresearch/hermes-agent`, шлюз `gateway run`, лимиты CPU/RAM |
| `deploy/agent/setup-agent.sh` | установка: swap, Docker, пользователь `agent` без sudo, сетевая изоляция, nginx |
| `deploy/agent/agent-firewall.sh` | контейнеру доступен хост только по 80/443; метаданные облака и частные сети закрыты |
| `deploy/agent/configure-agent.sh` | ключи в `.env` (только на сервере), модель, проверка через CLI, запуск шлюза |
| `deploy/agent/config.example.yaml`, `env.example` | образцы конфига и переменных - без секретов |
| `agent-lab/p4/` | эксперимент P4: 10 задач с проверками кодом, прогон, сводка, результаты |
| `agent-lab/journal.json` | журнал параметров, проверок и отладки |

## Конфигурация

- сервер: Timeweb, Ubuntu 26.04, 1 vCPU, 891 МБ RAM, 1 600 ₽/мес;
- модель: `deepseek-v4-flash` через OpenAI-совместимый шлюз `llms.dotpoin.com` (контекст 1M);
- данные агента: `/home/agent/.hermes` на хосте = `/opt/data` в контейнере.

## Запуск

```bash
HOST=root@<сервер> deploy/agent/setup-agent.sh
HOST=root@<сервер> DOTPOIN_API_KEY=... TELEGRAM_BOT_TOKEN=... TELEGRAM_ALLOWED_USERS=<свой ID> deploy/agent/configure-agent.sh
```

## Эксперимент P4

```bash
cd agent-lab/p4
node run.mjs --resume     # на сервере: задачи × модели × 3 повтора, результаты в runs/results.jsonl
node summarize.mjs        # сводка → results.json
```

Проверки (`tasks.mjs`) не используют LLM: ответ сверяется с фикстурами. Сейчас выполнен пилот - 4 прогона;
полный протокол - около 340 ₽ на три модели по прайсу шлюза.

Ключи и токены в репозиторий не входят.
