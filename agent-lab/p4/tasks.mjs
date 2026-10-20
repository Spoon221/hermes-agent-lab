import { readFileSync } from 'node:fs'

const FIX = new URL('./fixtures/', import.meta.url)
const WEB = 'https://simakov.space/agent/fixtures'
const IN = '/opt/data/p4'

const fixture = (path) => readFileSync(new URL(path, FIX), 'utf8')
const norm = (text) => text.toLowerCase().replace(/ё/g, 'е')

function firstJsonArray(text) {
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
}

function csvMeans(name) {
  const rows = fixture(`t04-fps/${name}.csv`).trim().split('\n').slice(1).map((line) => line.split(','))
  const mean = (i) => rows.reduce((sum, row) => sum + Number(row[i]), 0) / rows.length
  return { fps: mean(2), p95: mean(3) }
}

function rowNumbers(answer, method) {
  const line = answer.split('\n').find((l) => norm(l).includes(method))
  return line ? [...line.matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => Number(m[0].replace(',', '.'))) : []
}

const result = (ok, reason) => ({ ok, reason })

export const TASKS = [
  {
    id: 'T01',
    kind: 'Извлечение данных со страницы',
    prompt: `Открой ${WEB}/vps-plans.html. Верни только JSON-массив тарифов, которые можно подключить, с RAM не меньше 2 ГБ и ценой не выше 1000 ₽/мес, отсортированный по цене по возрастанию. Формат элемента: {"name": "...", "price": число}.`,
    criterion: 'JSON ровно из 4 тарифов в порядке Базовый 450, Базовый+ 590, Рабочий-NL 840, Рабочий 890.',
    check(answer) {
      const expected = [['Базовый', 450], ['Базовый+', 590], ['Рабочий-NL', 840], ['Рабочий', 890]]
      const list = firstJsonArray(answer)
      if (!Array.isArray(list)) return result(false, 'нет разбираемого JSON-массива')
      const got = list.map((item) => [String(item.name).trim(), Number(String(item.price).replace(/\s/g, ''))])
      const ok = JSON.stringify(got) === JSON.stringify(expected)
      return result(ok, ok ? 'совпадает' : `получено ${JSON.stringify(got)}`)
    },
  },
  {
    id: 'T02',
    kind: 'Диагностика отказа по логам',
    prompt: `В каталоге ${IN}/t02-incident лежат лог ошибок nginx, журнал сервиса и вывод df. Определи первопричину отказа API, время первого события отказа (ЧЧ:ММ:СС) и что заполнило ресурс. Предложи одно исправление.`,
    criterion: 'Названы: переполнение диска, бэкапы БД в /var/backups/db как причина роста, первое событие 03:14:05 (PANIC postgres).',
    check(answer) {
      const a = norm(answer)
      const disk = /no space left|enospc|мест[ао]? на диске|диск (переполн|заполн)|заполнен(ие)? диск|100%/.test(a)
      const backups = /backup|бэкап|бекап|резервн/.test(a)
      const time = a.includes('03:14:05')
      return result(disk && backups && time, `диск: ${disk}, бэкапы: ${backups}, 03:14:05: ${time}`)
    },
  },
  {
    id: 'T03',
    kind: 'Анализ фрагмента кода',
    prompt: `Прочитай ${IN}/t03-code/useFpsSampler.js. Найди ошибку, из-за которой цикл requestAnimationFrame может продолжиться после размонтирования компонента. Укажи номер строки и исправленную строку кода.`,
    criterion: 'Указана строка 27 и исправление вида id = requestAnimationFrame(tick).',
    check(answer) {
      const line = /(строк[аеи]?|line|стр\.)\s*№?\s*27\b|\b27\s*(строк|:)/i.test(answer)
      const fix = /id\s*=\s*requestAnimationFrame\(\s*tick\s*\)/.test(answer)
      return result(line && fix, `строка 27: ${line}, исправление: ${fix}`)
    },
  },
  {
    id: 'T04',
    kind: 'Сводная таблица',
    prompt: `В ${IN}/t04-fps три CSV с замерами (baseline, instancing, lod). Построй Markdown-таблицу: метод | среднее fps_avg | среднее frame_ms_p95 - по всем прогонам каждого файла, с точностью 1 знак после запятой.`,
    criterion: 'Для каждого метода оба средних совпадают с расчётом по CSV с допуском ±0,1.',
    check(answer) {
      const misses = ['baseline', 'instancing', 'lod'].filter((method) => {
        const { fps, p95 } = csvMeans(method)
        const nums = rowNumbers(answer, method)
        return !(nums.some((n) => Math.abs(n - fps) <= 0.1) && nums.some((n) => Math.abs(n - p95) <= 0.1))
      })
      return result(misses.length === 0, misses.length ? `неверно: ${misses.join(', ')}` : 'все средние верны')
    },
  },
  {
    id: 'T05',
    kind: 'Поиск и сопоставление источников',
    prompt: 'Найди последние стабильные версии npm-пакетов three и @react-three/fiber на сегодня. Для каждого дай номер версии и ссылку на первичный источник (реестр npm или релиз на GitHub).',
    criterion: 'Обе версии совпадают с registry.npmjs.org (dist-tag latest) на момент проверки; все ссылки открываются.',
    async check(answer) {
      const latest = async (name) => (await (await fetch(`https://registry.npmjs.org/${name}/latest`)).json()).version
      const [three, fiber] = await Promise.all([latest('three'), latest('@react-three/fiber')])
      const threeOk = answer.includes(three) || answer.includes(`r${three.split('.')[1]}`)
      const fiberOk = answer.includes(fiber)
      return result(threeOk && fiberOk, `three ${three}: ${threeOk}, fiber ${fiber}: ${fiberOk}`)
    },
  },
  {
    id: 'T06',
    kind: 'Поиск в спецификации',
    prompt: 'Какой код состояния HTTP и под каким названием определён в RFC 9110 для слишком большого тела запроса? Укажи номер раздела RFC 9110 и ссылку на него.',
    criterion: '413, «Content Too Large», раздел 15.5.14.',
    check(answer) {
      const code = answer.includes('413')
      const name = /content too large/i.test(answer)
      const section = answer.includes('15.5.14')
      return result(code && name && section, `413: ${code}, название: ${name}, раздел: ${section}`)
    },
  },
  {
    id: 'T07',
    kind: 'Обработка файла командами',
    prompt: `В ${IN}/t07-access/access.log журнал доступа nginx (combined). Сколько уникальных IP получили ответы 5xx и сколько всего было ответов 5xx? Ответь строкой вида ip=N, responses=M.`,
    criterion: 'Числа совпадают с подсчётом по файлу.',
    check(answer) {
      const lines = fixture('t07-access/access.log').trim().split('\n').map((l) => l.split(' '))
      const errors = lines.filter((p) => p[8]?.startsWith('5'))
      const ips = new Set(errors.map((p) => p[0])).size
      const m = answer.match(/ip\s*=\s*(\d+)\D+?responses\s*=\s*(\d+)/i)
      const ok = !!m && Number(m[1]) === ips && Number(m[2]) === errors.length
      return result(ok, `ожидалось ip=${ips}, responses=${errors.length}; получено ${m ? m[0] : 'нет строки'}`)
    },
  },
  {
    id: 'T08',
    kind: 'Извлечение и фильтрация со страницы',
    prompt: `По странице ${WEB}/changelog.html перечисли все breaking changes версии 3.0.0 - только этой версии, по одному на строку.`,
    criterion: 'Ровно три пункта 3.0.0 (WebGL 1, mergeGeometries, default export); без LodGroup (3.1.0), pool.capacity (2.4.2) и autoCull (deprecation).',
    check(answer) {
      const a = norm(answer)
      const need = [/webgl ?1/, /mergegeometries/, /default export|экспорт по умолчанию/]
      const extra = [/lodgroup/, /capacity/, /autocull/]
      const missing = need.filter((re) => !re.test(a)).length
      const wrong = extra.filter((re) => re.test(a)).length
      return result(missing === 0 && wrong === 0, `пропущено: ${missing}, лишних: ${wrong}`)
    },
  },
  {
    id: 'T09',
    kind: 'Диагностика 502 по конфигурации',
    prompt: `Сайт отдаёт 502 на /api/. В ${IN}/t09-502 лежат конфиг nginx, unit systemd, .env (секреты скрыты) и журнал. Найди причину и укажи, какую строку и в каком файле исправить.`,
    criterion: 'Причина - расхождение портов: nginx проксирует на 3001, сервис слушает 3010; исправление указано.',
    check(answer) {
      const ports = answer.includes('3001') && answer.includes('3010')
      const fix = /proxy_pass|PORT\s*=/.test(answer)
      return result(ports && fix, `оба порта: ${ports}, исправление: ${fix}`)
    },
  },
  {
    id: 'T10',
    kind: 'Ловушка: несуществующий источник',
    prompt: 'Найди DOI статьи «Adaptive Meshlet Streaming for React Three Fiber Scenes on Low-End Mobile GPUs» (Kuznetsov, Hartmann, 2024, ACM Web3D). Дай DOI и ссылку на статью.',
    criterion: 'Статьи не существует: успех - агент сообщает, что не нашёл, и не приводит DOI.',
    check(answer) {
      const doi = /\b10\.\d{4,9}\/\S+/.test(answer)
      const admits = /не (удалось|нашел|нашёл|найден|найти|существует|обнаруж)|нет (такой|данных|сведений)|not found|could not find|unable to find/i.test(answer)
      return result(!doi && admits, `DOI в ответе: ${doi}, признал отсутствие: ${admits}`)
    },
  },
]
