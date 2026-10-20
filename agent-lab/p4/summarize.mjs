#!/usr/bin/env node
/**
 * @fileoverview Сводка эксперимента P4 для страницы: runs/results.jsonl + annotations.json →
 * public/agent/results.json. Запускается локально после того, как results.jsonl скопирован с VPS:
 *
 *   scp agent@AGENT_HOST:~/agent-lab/p4/runs/results.jsonl runs/ && node summarize.mjs
 *
 * annotations.json - ручная разметка: { "<runId>": { "falseClaims": 1, "failure": "...", "note": "..." } }.
 * Её нужно делать по тексту ответа, не глядя на автоматический вердикт.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { TASKS } from './tasks.mjs'

const read = (path, fallback) => (existsSync(new URL(path, import.meta.url)) ? readFileSync(new URL(path, import.meta.url), 'utf8') : fallback)
const config = JSON.parse(read('./models.json'))
const notes = JSON.parse(read('./annotations.json', '{}'))
const runs = read('./runs/results.jsonl', '').trim().split('\n').filter(Boolean).map((line) => {
  const run = JSON.parse(line)
  const note = notes[run.runId] ?? {}
  return { ...run, falseClaims: note.falseClaims ?? (run.deadLinks?.length ? run.deadLinks.length : 0), failure: note.failure ?? run.failure, note: note.note ?? null }
})

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
const sd = (xs) => {
  if (xs.length < 2) return null
  const m = mean(xs)
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1))
}
const nums = (list, key) => list.map((r) => r[key]).filter((v) => typeof v === 'number')

function aggregate(list) {
  // Стоимость - по прогонам, где токены измерены; прогоны без отчёта --usage-file в неё не входят.
  const priced = list.filter((r) => typeof r.costRub === 'number')
  const costs = nums(priced, 'costRub')
  const successes = list.filter((r) => r.ok).length
  const pricedSuccesses = priced.filter((r) => r.ok).length
  return {
    runs: list.length,
    successes,
    successRate: list.length ? successes / list.length : null,
    seconds: mean(nums(list, 'seconds')),
    secondsSd: sd(nums(list, 'seconds')),
    steps: mean(nums(list, 'steps')),
    stepsSd: sd(nums(list, 'steps')),
    tokensIn: mean(nums(list, 'tokensIn')),
    tokensOut: mean(nums(list, 'tokensOut')),
    costRub: costs.length ? costs.reduce((a, b) => a + b, 0) : null,
    costRuns: costs.length,
    costPerSuccessRub: pricedSuccesses ? costs.reduce((a, b) => a + b, 0) / pricedSuccesses : null,
    falseClaims: list.reduce((s, r) => s + (r.falseClaims ?? 0), 0),
  }
}

const cells = []
for (const model of config.models) {
  for (const task of TASKS) {
    const list = runs.filter((r) => r.model === model.id && r.task === task.id)
    if (list.length) cells.push({ model: model.id, task: task.id, ...aggregate(list), outcomes: list.sort((a, b) => a.repeat - b.repeat).map((r) => r.ok) })
  }
}

const failures = {}
runs.filter((r) => r.failure).forEach((r) => {
  failures[r.failure] ??= []
  failures[r.failure].push({ runId: r.runId, task: r.task, model: r.model, reason: r.reason, note: r.note })
})

const summary = {
  generatedAt: new Date().toISOString(),
  // Пилот: протокол (10 задач × модели × 3 повтора) выполнен не полностью - см. note.
  plannedRuns: TASKS.length * config.models.length * 3,
  note: read('./note.txt', '').trim() || null,
  rubPerUsd: config.rub_per_usd,
  tasks: TASKS.map(({ id, kind, prompt, criterion }) => ({ id, kind, prompt, criterion })),
  models: config.models.map(({ id, label, class: cls, context, currency, price_in, price_out, price_checked }) => ({ id, label, class: cls, context, currency, price_in, price_out, price_checked })),
  byModel: Object.fromEntries(config.models.map((m) => [m.id, aggregate(runs.filter((r) => r.model === m.id))])),
  cells,
  failures,
  runs: runs.map(({ answer, stderr, ...rest }) => ({ ...rest, answer: answer?.slice(0, 1500) })),
}

// В репозитории сайта сводка пишется в public/agent/results.json; здесь - рядом.
const out = new URL('./results.json', import.meta.url)
writeFileSync(out, `${JSON.stringify(summary, null, 2)}\n`)
console.log(`Прогонов: ${runs.length} → ${out.pathname}`)
