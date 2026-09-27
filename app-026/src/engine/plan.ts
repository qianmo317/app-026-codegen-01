import type { Cue, Line, PlanConfig, Script } from '../types'
import { DEFAULT_CUE_SECONDS, HOLDABLE_KINDS } from '../constants'

export const DEFAULT_CHARS_PER_MINUTE = 120
export const DEFAULT_SESSION_MINUTES = 60

/* ---------------- 字数 ---------------- */

const CJK_RE = /[㐀-鿿豈-﫿]/
/**
 * 念白字数：汉字每个算 1；连续的拉丁字母/数字串按「词」算 1（英文按词数念）；
 * 标点、空白、标记占位不算。
 */
export function spokenCount(text: string): number {
  let n = 0
  let inWord = false
  for (const ch of text) {
    if (CJK_RE.test(ch)) {
      n += 1
      inWord = false
    } else if (/[A-Za-z0-9]/.test(ch)) {
      if (!inWord) {
        n += 1
        inWord = true
      }
    } else {
      inWord = false
    }
  }
  return n
}

/* ---------------- 单句 / 单段用时 ---------------- */

/** 句中停顿秒数：过门/锣鼓/停顿标记之和（注不停留） */
export function cueSeconds(cues: Cue[]): number {
  return cues
    .filter((c) => HOLDABLE_KINDS.includes(c.kind))
    .reduce((sum, c) => sum + (c.seconds ?? DEFAULT_CUE_SECONDS[c.kind as 'pause'] ?? 0), 0)
}

export interface LineTiming {
  lineId: string
  index: number
  role?: string
  text: string
  chars: number
  speakSeconds: number
  pauseSeconds: number
  /** 实际用时（秒）= 念白 + 停顿 */
  seconds: number
  /** 手工改写段时按比例摊到各句的系数（未改写为 1） */
  scaled: boolean
}

export interface SegmentTiming {
  segmentId: string
  index: number
  title: string
  lineIds: string[]
  lineCount: number
  chars: number
  pauseSeconds: number
  /** 估算用时（秒）：Σ(念白 + 停顿) */
  estimatedSeconds: number
  custom?: number
  /** 实际用时（秒）：有手工改写取改写值 */
  seconds: number
  /** 整场累计到本段结束（秒） */
  cumulativeSeconds: number
  lines: LineTiming[]
}

export interface Plan {
  charsPerMinute: number
  segmentCount: number
  totalChars: number
  totalPauseSeconds: number
  totalSeconds: number
  segments: SegmentTiming[]
  sessions: RehearsalSession[]
}

/** 把段内各句用时按比例摊到目标秒数；基础为 0 时按句数均分 */
function scaleLines(lines: LineTiming[], target: number): LineTiming[] {
  const base = lines.reduce((s, l) => s + l.seconds, 0)
  if (base <= 0) {
    const each = lines.length ? target / lines.length : 0
    return lines.map((l) => ({ ...l, seconds: each, scaled: true }))
  }
  const ratio = target / base
  return lines.map((l) => ({ ...l, seconds: l.seconds * ratio, scaled: true }))
}

/**
 * 整场估算：按念白速度算每句用时，加句中停顿得每段用时，顺序累加出整场总时长；
 * segmentCustomSeconds 中的手工改写段以改写值为准（各句用时按比例摊，保证切分仍可定位到句）。
 */
export function buildPlan(script: Script, config?: Partial<PlanConfig>): Plan {
  const cpm = config?.charsPerMinute && config.charsPerMinute > 0
    ? config.charsPerMinute
    : DEFAULT_CHARS_PER_MINUTE
  const overrides = config?.segmentCustomSeconds ?? {}
  const lineById = new Map(script.lines.map((l) => [l.id, l]))

  let totalChars = 0
  let totalPause = 0
  let total = 0

  const timings: SegmentTiming[] = script.segments.map((seg, si) => {
    const lts: LineTiming[] = []
    seg.lineIds.forEach((lid, li) => {
      const line: Line | undefined = lineById.get(lid)
      if (!line) return
      const chars = spokenCount(line.text)
      const pause = cueSeconds(line.cues)
      const speak = (chars / cpm) * 60
      lts.push({
        lineId: lid,
        index: li,
        role: line.role,
        text: line.text,
        chars,
        speakSeconds: speak,
        pauseSeconds: pause,
        seconds: speak + pause,
        scaled: false,
      })
    })

    const chars = lts.reduce((s, l) => s + l.chars, 0)
    const pause = lts.reduce((s, l) => s + l.pauseSeconds, 0)
    const estimated = lts.reduce((s, l) => s + l.seconds, 0)
    const customRaw = overrides[seg.id]
    const custom = Number.isFinite(customRaw) && (customRaw as number) >= 0 ? customRaw : undefined
    const seconds = custom ?? estimated
    const lines = custom !== undefined ? scaleLines(lts, custom) : lts

    totalChars += chars
    totalPause += pause
    total += seconds

    return {
      segmentId: seg.id,
      index: si,
      title: seg.title,
      lineIds: seg.lineIds.filter((id) => lineById.has(id)),
      lineCount: lts.length,
      chars,
      pauseSeconds: pause,
      estimatedSeconds: estimated,
      custom,
      seconds,
      cumulativeSeconds: total,
      lines,
    } satisfies SegmentTiming
  })

  const sessionMinutes = config?.sessionMinutes && config.sessionMinutes > 0 ? config.sessionMinutes : 0
  const timedSegments = timings.filter((t) => t.lines.length > 0)
  const sessions = sessionMinutes > 0
    ? splitSessions(timedSegments, sessionMinutes * 60)
    : timedSegments.length
      ? wholeSession(timedSegments)
      : []

  return {
    charsPerMinute: cpm,
    segmentCount: timings.length,
    totalChars,
    totalPauseSeconds: totalPause,
    totalSeconds: total,
    segments: timings,
    sessions,
  }
}

/* ---------------- 排练切分 ---------------- */

export interface RehearsalSession {
  /** 1 起 */
  no: number
  segments: SegmentTiming[]
  seconds: number
  /** 本次从哪一段第几句开始（段序、句序均 1 起） */
  startSegment: number
  startLine: number
  /** 本次结束到哪一段（段序，1 起） */
  endSegment: number
  /** 结束段练到第几句（1 起；整段练完 = 该段句数） */
  endLine: number
  /** 下一次从哪一段的第几句开始（段序 1 起；句序 1 起；最后一次为 null） */
  nextStart: { segment: number; line: number } | null
  /** 本次有段被上限截断（某段自身比一次排练还长，或段在句间断开） */
  truncated: boolean
}

/**
 * 贪心装箱：顺序装段，装不下就再开一次；
 * 单段自身超过上限时，在该段内部按句切，保证「本次练到哪段第几句 / 下次从哪段第几句起」可定位。
 * 入参只含至少有一句的段（空段不占排练次）；段的 index 为其在整场中的 0 基段序。
 */
function splitSessions(segments: SegmentTiming[], capSeconds: number): RehearsalSession[] {
  const sessions: RehearsalSession[] = []
  let si = 0 // 当前段 index（segments 内）
  let li = 0 // 当前段起始句 index
  const EPS = 1e-6

  while (si < segments.length) {
    const startSeg = segments[si]
    const startLineNo = li + 1
    let used = 0
    const picked: { seg: SegmentTiming; endLineExclusive: number }[] = []
    let truncated = false

    while (si < segments.length) {
      const seg = segments[si]
      // 从 li 起顺序取句，看最多能把几句装进本次
      let j = li
      let acc = 0
      while (j < seg.lines.length) {
        const t = seg.lines[j].seconds
        if (used + acc + t > capSeconds + EPS) break
        acc += t
        j += 1
      }

      if (j === li) {
        // 当前剩余内容一句都装不下
        if (picked.length === 0) {
          // 本次还是空的：单句超过上限也强制带走一句，避免死循环
          acc = seg.lines[li].seconds
          j = li + 1
          truncated = true
        } else {
          // 本次已装满 → 本轮结束，下一次新开
          break
        }
      }

      used += acc
      picked.push({ seg, endLineExclusive: j })

      if (j < seg.lines.length) {
        // 该段在句间断开：本次到此为止，下次从断点继续
        truncated = true
        li = j
        break
      }
      si += 1
      li = 0
      if (used >= capSeconds - EPS) break
    }

    const last = picked[picked.length - 1]
    sessions.push({
      no: sessions.length + 1,
      segments: picked.map((p) => p.seg),
      seconds: used,
      startSegment: startSeg.index + 1,
      startLine: startLineNo,
      endSegment: last.seg.index + 1,
      endLine: last.endLineExclusive,
      nextStart: nextStartOf(segments, si, li),
      truncated,
    })
  }
  return sessions
}

/** 从（段 segIdx、句 lineIdx）起，下一个要练的句（均 0 基）；已到整场末尾返回 null */
function nextStartOf(
  segments: SegmentTiming[],
  segIdx: number,
  lineIdx: number,
): { segment: number; line: number } | null {
  let a = segIdx
  let b = lineIdx
  while (a < segments.length) {
    if (b < segments[a].lines.length) return { segment: a + 1, line: b + 1 }
    a += 1
    b = 0
  }
  return null
}

function wholeSession(segments: SegmentTiming[]): RehearsalSession[] {
  const first = segments[0]
  const last = segments[segments.length - 1]
  return [{
    no: 1,
    segments,
    seconds: last.cumulativeSeconds,
    startSegment: first.index + 1,
    startLine: 1,
    endSegment: last.index + 1,
    endLine: last.lineCount,
    nextStart: null,
    truncated: false,
  }]
}

/* ---------------- 格式化与导出 ---------------- */

/** 秒 → h:mm:ss（不足 1 小时为 m:ss） */
export function formatClock(totalSeconds: number): string {
  const s = Math.round(totalSeconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  const ss = String(sec).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/** 秒 → 「X分YY秒 / X小时YY分」式中文时长 */
export function formatDuration(totalSeconds: number): string {
  const s = Math.round(totalSeconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h} 小时 ${m} 分${sec ? ` ${sec} 秒` : ''}`
  if (m > 0) return `${m} 分${sec ? ` ${sec} 秒` : ''}`
  return `${sec} 秒`
}

/** 某次排练的起止描述，如「第 1 段 第 1 句 → 第 3 段 第 4 句」 */
export function sessionRangeText(s: RehearsalSession): string {
  return `第 ${s.startSegment} 段 第 ${s.startLine} 句 → 第 ${s.endSegment} 段 第 ${s.endLine} 句`
}

const CSV_HEADERS = ['段序', '段名', '句数', '字数', '停顿(秒)', '估算用时', '实际用时', '累计用时', '手工改写']

/** 导出 CSV（带 BOM，Excel 打开中文不乱码） */
export function planToCSV(plan: Plan, script: Script): string {
  const esc = (v: string | number) => {
    const s = String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const rows: string[] = [CSV_HEADERS.join(',')]
  for (const seg of plan.segments) {
    rows.push([
      seg.index + 1,
      seg.title,
      seg.lineCount,
      seg.chars,
      seg.pauseSeconds.toFixed(1),
      formatClock(seg.estimatedSeconds),
      formatClock(seg.seconds),
      formatClock(seg.cumulativeSeconds),
      seg.custom !== undefined ? '是' : '',
    ].map(esc).join(','))
  }
  rows.push('')
  rows.push(`剧目,${esc(script.title)},总句数,${plan.segments.reduce((s, x) => s + x.lineCount, 0)},总字数,${plan.totalChars},总时长,${formatClock(plan.totalSeconds)}`)
  if (plan.sessions.length > 1 || (plan.sessions.length === 1 && plan.sessions[0].truncated)) {
    rows.push('')
    rows.push(['次别', '起止', '本次时长', '练到（结束）', '下次起点'].join(','))
    for (const s of plan.sessions) {
      rows.push([
        `第 ${s.no} 次`,
        sessionRangeText(s),
        formatClock(s.seconds),
        `第 ${s.endSegment} 段第 ${s.endLine} 句结束`,
        s.nextStart ? `第 ${s.nextStart.segment} 段第 ${s.nextStart.line} 句` : '（已排完）',
      ].map(esc).join(','))
    }
  }
  return '﻿' + rows.join('\r\n')
}

/** 导出纯文本计划表 */
export function planToText(plan: Plan, script: Script): string {
  const w = (n: number) => String(n).padStart(2, ' ')
  const lines: string[] = []
  lines.push(`排戏计划表《${script.title}》${script.troupe ? `（${script.troupe}）` : ''}`)
  lines.push(`念白速度：${plan.charsPerMinute} 字/分钟　总字数：${plan.totalChars}　句中停顿合计：${formatDuration(plan.totalPauseSeconds)}`)
  lines.push(`整场总时长（估）：${formatDuration(plan.totalSeconds)}（${formatClock(plan.totalSeconds)}）`)
  lines.push('')
  lines.push('段序 段名                  句数  字数  停顿   本段用时   累计用时  备注')
  lines.push('─'.repeat(72))
  for (const seg of plan.segments) {
    const name = seg.title.slice(0, 16).padEnd(16, '　')
    lines.push(
      `${w(seg.index + 1)}  ${name} ${String(seg.lineCount).padStart(3)} ${String(seg.chars).padStart(5)} ` +
      `${formatClock(seg.pauseSeconds).padStart(5)} ` +
      `${formatClock(seg.seconds).padStart(9)} ${formatClock(seg.cumulativeSeconds).padStart(9)}  ` +
      `${seg.custom !== undefined ? `手工改写（原估 ${formatClock(seg.estimatedSeconds)}）` : ''}`,
    )
  }
  if (plan.sessions.length > 1 || (plan.sessions.length === 1 && plan.sessions[0].truncated)) {
    lines.push('')
    lines.push('排练切分')
    lines.push('─'.repeat(72))
    for (const s of plan.sessions) {
      lines.push(
        `第 ${s.no} 次（${formatDuration(s.seconds)}）：${sessionRangeText(s)}` +
        (s.truncated ? '（该段未完，拆到句）' : ''),
      )
      lines.push(
        `　　练到：第 ${s.endSegment} 段《${plan.segments[s.endSegment - 1]?.title ?? ''}》第 ${s.endLine} 句结束` +
        (s.nextStart ? `；下次从第 ${s.nextStart.segment} 段第 ${s.nextStart.line} 句起` : '；整场排完'),
      )
    }
  }
  return lines.join('\n')
}

/** 浏览器端下载导出文件 */
export function downloadPlanFile(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** 段配置迁移/兜底：旧剧本没有 plan 字段时给默认值 */
export function defaultPlanConfig(): PlanConfig {
  return {
    charsPerMinute: DEFAULT_CHARS_PER_MINUTE,
    sessionMinutes: DEFAULT_SESSION_MINUTES,
    segmentCustomSeconds: {},
  }
}

export function normalizePlanConfig(plan?: PlanConfig): PlanConfig {
  const d = defaultPlanConfig()
  return {
    charsPerMinute: plan?.charsPerMinute && plan.charsPerMinute > 0 ? plan.charsPerMinute : d.charsPerMinute,
    sessionMinutes: plan?.sessionMinutes && plan.sessionMinutes > 0 ? plan.sessionMinutes : 0,
    segmentCustomSeconds: plan?.segmentCustomSeconds ?? {},
  }
}

/** 段被删除后清理悬挂的手工改写 */
export function pruneOverrides(segments: { id: string }[], overrides: Record<string, number>): Record<string, number> {
  const ids = new Set(segments.map((s) => s.id))
  return Object.fromEntries(Object.entries(overrides).filter(([id]) => ids.has(id)))
}
