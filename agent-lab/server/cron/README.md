# Задачи по расписанию

Созданы на сервере командой `hermes cron create` внутри контейнера (хранятся в `/opt/data/cron/jobs.json`).

## site-monitor - ежедневно в 09:00 UTC

```
hermes cron create "0 9 * * *" "Проверь https://simakov.space/ и https://simakov.space/api/benchmarks: код ответа, время ответа в мс, число записей в JSON. Допиши строку дата,код_сайта,мс_сайта,код_api,мс_api,записей в /opt/data/research/monitoring.csv (создай с заголовком, если нет). Если какой-то код не 200 - начни ответ со слова ALERT, иначе ответь [SILENT]." --name site-monitor
```

## site-monitor-test - разовая проверка автономного запуска

```
hermes cron create "in 1m" "Проверь https://simakov.space/api/benchmarks: код ответа, время ответа в мс и число записей в JSON. Допиши строку дата,код,мс,записей в /opt/data/research/monitoring.csv (создай с заголовком, если нет) и кратко ответь результатом." --name site-monitor-test --deliver local
```

Результат 20.10.2026 13:48 UTC, `/opt/data/research/monitoring.csv`:

```
date,http_code,ms,records
2026-10-20,200,331,7
```

## Очистка вывода cron (crontab пользователя agent на хосте)

```
0 4 * * * find /home/agent/.hermes/cron/output -type f -mtime +90 -delete
```
