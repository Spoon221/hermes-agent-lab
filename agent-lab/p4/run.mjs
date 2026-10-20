#!/usr/bin/env node
/**
 * @fileoverview Прогон эксперимента P4 на VPS агента (Node 18+, пользователь agent).
 *
 *   node run.mjs                       # все задачи × все модели × 3 повтора
 *   node run.mjs --tasks T01,T07 --models deepseek-v4-flash --repeats 1
 *
 * Каждый прогон - отдельная одноразовая сессия `hermes -z` в контейнере. До и после прогона
 * память (memories/) и навыки (skills/) восстанавливаются из снимка, чтобы агент не учился
 * между повторами и задачами и прогоны оставались независимыми. Результаты дописываются
 * в runs/results.jsonl построчно, поэтому прерванный эксперимент можно продолжить (--resume).
 */
import { spawn, execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { TASKS } from './tasks.mjs'

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, arg, i, all) => {
  if (arg.startsWith('--')) pairs.push([arg.slice(2), all[i + 1]?.startsWith('--') ? true : all[i + 1] ?? true])
  return pairs
}, []))

const CONFIG = JSON.parse(readFileSync(new URL('./models.json', import.meta.url), 'utf8'))
const OUT = new URL('./runs/results.jsonl', import.meta.url)
mkdirSync(new URL('./runs/', import.meta.url), { recursive: true })
const FIXTURES = new URL('./fixtures/', import.meta.url).pathname
const TIMEOUT_MS = Number(args.timeout ?? 600) * 1000
const REPEATS = Number(args.repeats ?? 3)
const pick = (list, key) => (args[key] ? list.filter((x) => args[key].split(',').includes(x.id)) : list)
const tasks = pick(TASKS, 'tasks')
const models = pick(CONFIG.models, 'models')

// Всё внутри контейнера - от пользователя hermes (UID = agent на хосте), а не root:
// иначе агент не сможет писать в /opt/data/p4, а память и навыки станут принадлежать root.
const docker = (container, ...cmd) => execFileSync('docker', ['exec', '-u', 'hermes', container, ...cmd], { encoding: 'utf8' })

/** Снимок и откат памяти и навыков агента внутри контейнера. */
const snapshot = (c) => docker(c, 'sh', '-c', 'cd /opt/data && tar -cf /tmp/p4-state.tar memories skills 2>/dev/null || true')
const restore = (c) => docker(c, 'sh', '-c', 'cd /opt/data && [ -f /tmp/p4-state.tar ] && rm -rf memories skills && tar -xf /tmp/p4-state.tar || true')

/** Ссылки из ответа, которые не открываются (признак выдуманной ссылки). */
async function deadLinks(text) {
  const urls = [...new Set(text.match(/https?:\/\/[^\s)\]>"'`]+/g) ?? [])].map((u) => u.replace(/[.,;:]+$/, ''))
  const dead = []
  for (const url of urls) {
    try {
      const res = await fetch(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(15000) })
      if (res.status >= 400 && res.status !== 403 && res.status !== 429) dead.push(`${url} → ${res.status}`)
    } catch (err) {
      dead.push(`${url} → ${err.cause?.code ?? err.name}`)
    }
  }
  return { urls: urls.length, dead }
}

/** Один прогон: агент получает задачу, ответ проверяется, расход берётся из отчёта hermes. */
async function runOnce(task, model, repeat) {
  const container = model.container ?? 'hermes_agent'
  const runId = `${task.id}-${model.id}-r${repeat}-${Date.now()}`
  const usagePath = `/opt/data/p4/usage/${runId}.json`
  restore(container)
  const started = Date.now()
  const { code, stdout, stderr, timedOut } = await new Promise((resolve) => {
    const child = spawn('docker', ['exec', '-u', 'hermes', container, 'hermes', '-z', task.prompt,
      '--provider', model.provider, '--model', model.model, '--usage-file', usagePath])
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { err += d })
    const timer = setTimeout(() => {
      try { docker(container, 'pkill', '-f', runId) } catch { /* процесс уже завершился */ }
      child.kill('SIGKILL')
      resolve({ code: null, stdout: out, stderr: err, timedOut: true })
    }, TIMEOUT_MS)
    child.on('close', (exitCode) => {
      clearTimeout(timer)
      resolve({ code: exitCode, stdout: out, stderr: err, timedOut: false })
    })
  })
  const seconds = (Date.now() - started) / 1000

  let usage = null
  try { usage = JSON.parse(docker(container, 'cat', usagePath)) } catch { /* отчёта нет */ }
  // Hermes: input_tokens - только некэшированный вход; кэш считается отдельно (cache_read/write).
  // Вспомогательные вызовы (заголовок сессии, review) - в usage.auxiliary.
  const sum = (key) => (usage ? (usage[key] ?? 0) + (usage.auxiliary?.[key] ?? 0) : null)
  const tokensCached = sum('cache_read_tokens')
  const tokensIn = usage ? sum('input_tokens') + tokensCached + sum('cache_write_tokens') : null
  const tokensOut = sum('output_tokens')
  const steps = usage?.api_calls ?? null

  const rate = model.currency === 'USD' ? CONFIG.rub_per_usd : 1
  const cost = model.price_in === null || tokensIn === null || tokensOut === null ? null
    : (((tokensIn - tokensCached) * model.price_in + tokensCached * model.price_cache + tokensOut * model.price_out) / 1e6) * rate

  const answer = stdout.trim()
  let verdict
  try {
    verdict = timedOut ? { ok: false, reason: 'таймаут' } : await task.check(answer)
  } catch (err) {
    verdict = { ok: false, reason: `ошибка проверки: ${err.message}` }
  }
  const links = await deadLinks(answer)

  const failure = timedOut ? 'зацикливание/таймаут'
    : code !== 0 ? 'ошибка запуска'
    : !answer ? 'преждевременная остановка'
    : links.dead.length ? 'выдуманная/битая ссылка'
    : null

  return {
    runId, task: task.id, model: model.id, repeat, date: new Date(started).toISOString(),
    ok: verdict.ok, reason: verdict.reason, failure, exitCode: code, seconds,
    steps, tokensIn, tokensOut, tokensCached, costRub: cost,
    hermesCostUsd: usage?.total_including_auxiliary?.estimated_cost_usd ?? null,
    turnExit: usage?.turn_exit_reason ?? null,
    urls: links.urls, deadLinks: links.dead, answer, stderr: stderr.slice(-2000),
  }
}

// Фикстуры - в /opt/data/p4 контейнера(ов).
for (const container of new Set(models.map((m) => m.container ?? 'hermes_agent'))) {
  execFileSync('docker', ['exec', container, 'mkdir', '-p', '/opt/data/p4/usage'])
  execFileSync('docker', ['cp', `${FIXTURES}.`, `${container}:/opt/data/p4/`])
  execFileSync('docker', ['exec', container, 'chown', '-R', 'hermes:hermes', '/opt/data/p4'])
  snapshot(container)
}

const done = new Set(args.resume && existsSync(OUT)
  ? readFileSync(OUT, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((r) => `${r.task}|${r.model}|${r.repeat}`)
  : [])

// Повторы - внешний цикл, модели - внутренний: дрейф во времени (нагрузка провайдера,
// смена версии модели) распределяется по всем моделям поровну.
for (let repeat = 1; repeat <= REPEATS; repeat++) {
  for (const task of tasks) {
    for (const model of models) {
      if (done.has(`${task.id}|${model.id}|${repeat}`)) continue
      const row = await runOnce(task, model, repeat)
      appendFileSync(OUT, `${JSON.stringify(row)}\n`)
      console.log(`${row.ok ? '✓' : '✗'} ${task.id} ${model.id} r${repeat} ${row.seconds.toFixed(1)}s ${row.reason}${row.failure ? ` [${row.failure}]` : ''}`)
    }
  }
}
for (const container of new Set(models.map((m) => m.container ?? 'hermes_agent'))) restore(container)
