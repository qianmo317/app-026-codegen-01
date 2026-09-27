import type { Line, Script } from '../types'
import { HOLDABLE_KINDS } from '../constants'

/**
 * 排戏时长估算引擎
 *
 * 输入：按角色分行、句中夹着【停顿N】【过门N】【锣鼓】提示的剧本。
 * 规则：
 * - 念字用时 = 字数 / 念白速度（每分钟多少字）
 * - 句用时 = 念字用时 + 句中停顿提示的秒数
 * - 段用时 = 各句累加；整场用时 = 各段累加
 * - 个别段估不准时可手工改写整段秒数，改写后按句估时比例摊到各句，
 *   这样切分（按句贪心）与累计用时都跟着重算。
 */

/** 默认念白速度：字/分钟 */
export const DEFAULT_WORDS_PER_MIN = 180
/** 默认每次排练时长上限：分钟 */
export const DEFAULT_SESSION_MINUTES = 90

export interface TimingConfig {
  /** 念白速度，每分钟多少字 */
  wordsPerMin: number
  /** 每次排练时长上限（分钟） */
  sessionMinutes: number
  /** 手工改写的整段用时（秒），按段 id 索引；删除 key 即恢复估算 */
  overrides: Record<string, number>
}

export function defaultTimingConfig(): TimingConfig {
  return { wordsPerMin: DEFAULT_WORDS_PER_MIN, sessionMinutes: DEFAULT_SESSION_MINUTES, overrides: {} }
}

/** 句级计时 */
export interface LineTiming {
  lineId: string
  /** 念白字数（汉字按字，连续的拉丁字母/数字串按一个词） */
  words: number
  /** 句中停顿秒数（停顿/过门/锣鼓之和，批注不停留） */
  pauseSeconds: number
  /** 纯估算用时（秒）：念字 + 停顿 */
  estimatedSeconds: number
  /** 生效用时（秒）：所在段被手工改写时按比例摊分，否则等于估算值 */
  effectiveSeconds: number
  /** 该句在本段内的句序（1 起） */
  sentenceNo: number
}

/** 段级计时（计划表的一行） */
export interface SegmentTiming {
  segmentId: string
  /** 段序（1 起） */
  index: number
  title: string
  sentenceCount: number
  words: number
  pauseSeconds: number
  /** 估算用时（秒） */
  estimatedSeconds: number
  /** 生效用时（秒），手工改写后与估算值不同 */
  effectiveSeconds: number
  /** 是否手工改写 */
  overridden: boolean
  /** 累计到本段结束的整场用时（秒，生效口径） */
  cumulativeSeconds: number
  lines: LineTiming[]
}

/* ------------------------------------------------------------------ */
/* 字数统计                                                            */
/* ------------------------------------------------------------------ */

/** 统计连续拉丁字母/数字词：英文单词、数字串各算一个 */
const LATIN_WORD_RE = /[A-Za-z0-9]+(?:[.\-'][A-Za-z0-9]+)*/g
const CJK_RE = /[㐀-䶿一-鿿豈-﫿]/

/**
 * 念白字数：
 * - 汉字（含扩展 A）每个算 1
 * - 连续的拉丁字母/数字串（如「OK」「123」「app-026」）整体算 1
 * - 标点、空格不算
 */
export function countWords(text: string): number {
  let n = 0
  for (const ch of text) {
    if (CJK_RE.test(ch)) n += 1
  }
  const latin = text.match(LATIN_WORD_RE)
  if (latin) n += latin.length
  return n
}

/* ------------------------------------------------------------------ */
/* 句 / 段 / 整场计时                                                  */
/* ------------------------------------------------------------------ */

/** 句中停顿秒数：停顿/过门/锣鼓（与滚动停留口径一致），批注不停留 */
export function linePauseSeconds(line: Line): number {
  return line.cues
    .filter((c) => HOLDABLE_KINDS.includes(c.kind))
    .reduce((sum, c) => sum + (c.seconds ?? 0), 0)
}

function lineEstimate(line: Line, wordsPerMin: number): { words: number; pause: number; seconds: number } {
  const words = countWords(line.text)
  const pause = linePauseSeconds(line)
  const speak = wordsPerMin > 0 ? (words / wordsPerMin) * 60 : 0
  return { words, pause, seconds: speak + pause }
}

/**
 * 计算整场计时表。
 * 空段（无有效行）跳过不编号；段顺序以 script.segments 为准。
 */
export function computeTiming(script: Script, cfg: TimingConfig): {
  segments: SegmentTiming[]
  totalSeconds: number
} {
  const lineById = new Map(script.lines.map((l) => [l.id, l] as const))
  const wpm = cfg.wordsPerMin > 0 ? cfg.wordsPerMin : DEFAULT_WORDS_PER_MIN

  const out: SegmentTiming[] = []
  let cumulative = 0
  let index = 0

  for (const seg of script.segments) {
    const lines = seg.lineIds
      .map((id) => lineById.get(id))
      .filter((l): l is Line => Boolean(l))
    if (lines.length === 0) continue

    index += 1
    const raw = lines.map((l) => lineEstimate(l, wpm))
    const words = raw.reduce((s, r) => s + r.words, 0)
    const pauseSeconds = raw.reduce((s, r) => s + r.pause, 0)
    const estimatedSeconds = raw.reduce((s, r) => s + r.seconds, 0)

    const override = cfg.overrides[seg.id]
    const overridden = Number.isFinite(override) && (override as number) >= 0
    const effectiveSeconds = overridden ? (override as number) : estimatedSeconds

    // 手工改写：按各句估算用时比例摊到句（全为 0 时均分），保证切分口径一致
    let lineSeconds: number[]
    if (overridden) {
      if (estimatedSeconds > 0) {
        lineSeconds = raw.map((r) => (r.seconds / estimatedSeconds) * effectiveSeconds)
      } else {
        lineSeconds = raw.map(() => effectiveSeconds / lines.length)
      }
    } else {
      lineSeconds = raw.map((r) => r.seconds)
    }

    cumulative += effectiveSeconds
    out.push({
      segmentId: seg.id,
      index,
      title: seg.title,
      sentenceCount: lines.length,
      words,
      pauseSeconds,
      estimatedSeconds,
      effectiveSeconds,
      overridden,
      cumulativeSeconds: cumulative,
      lines: lines.map((l, i) => ({
        lineId: l.id,
        words: raw[i].words,
        pauseSeconds: raw[i].pause,
        estimatedSeconds: raw[i].seconds,
        effectiveSeconds: lineSeconds[i],
        sentenceNo: i + 1,
      })),
    })
  }

  return { segments: out, totalSeconds: cumulative }
}

/* ------------------------------------------------------------------ */
/* 排练切分                                                            */
/* ------------------------------------------------------------------ */

export interface RehearsalSession {
  /** 第几次排练（1 起） */
  no: number
  /** 本次起点：段序（1 起） */
  startSegmentIndex: number
  /** 本次起点：该段第几句（1 起） */
  startSentenceNo: number
  /** 本次练到的段序（1 起） */
  endSegmentIndex: number
  /** 本次练到该段第几句（该段最后一句的句号 = 段句数） */
  endSentenceNo: number
  /** 本次起点段名 / 终点段名 */
  startSegmentTitle: string
  endSegmentTitle: string
  /** 本次实际用时（秒） */
  seconds: number
  /** 本次包含的句数 */
  sentenceCount: number
  /** 有单句本身就超过时长上限（只能整句练，本次被该句撑爆） */
  overflow: boolean
}

/**
 * 按每次排练时长上限，把整场按句贪心切成若干次：
 * 顺序往后装，再加一句就超时则收束本次；保证每句完整、不拆句。
 * 单句本身超过上限时，该句单独占一次并标记 overflow。
 */
export function splitRehearsals(timings: SegmentTiming[], sessionMinutes: number): RehearsalSession[] {
  const limit = sessionMinutes > 0 ? sessionMinutes * 60 : Infinity

  interface FlatItem {
    segIndex: number
    segTitle: string
    sentenceNo: number
    seconds: number
  }
  const items: FlatItem[] = []
  for (const seg of timings) {
    for (const lt of seg.lines) {
      items.push({ segIndex: seg.index, segTitle: seg.title, sentenceNo: lt.sentenceNo, seconds: lt.effectiveSeconds })
    }
  }

  const sessions: RehearsalSession[] = []
  let i = 0
  while (i < items.length) {
    const start = i
    let total = items[i].seconds
    let overflow = items[i].seconds > limit
    i += 1
    // 顺序装入：还能装下下一句就继续
    while (i < items.length && total + items[i].seconds <= limit) {
      total += items[i].seconds
      i += 1
    }
    const from = items[start]
    const to = items[i - 1]
    sessions.push({
      no: sessions.length + 1,
      startSegmentIndex: from.segIndex,
      startSentenceNo: from.sentenceNo,
      endSegmentIndex: to.segIndex,
      endSentenceNo: to.sentenceNo,
      startSegmentTitle: from.segTitle,
      endSegmentTitle: to.segTitle,
      seconds: total,
      sentenceCount: i - start,
      overflow,
    })
  }
  return sessions
}

/* ------------------------------------------------------------------ */
/* 格式化                                                              */
/* ------------------------------------------------------------------ */

/** 秒 → mm:ss 或 h:mm:ss（用于计划表展示，秒四舍五入） */
export function formatClock(seconds: number): string {
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/** 秒 → 「X小时Y分」「Y分Z秒」「Z秒」这种自然语言概览 */
export function formatDurationCN(seconds: number): string {
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return m > 0 ? `${h}小时${m}分` : `${h}小时`
  if (m > 0) return s > 0 ? `${m}分${s}秒` : `${m}分`
  return `${s}秒`
}

/** 供页面初始化 / 恢复配置用的工具 */
export function normalizeConfig(raw: Partial<TimingConfig> | undefined | null): TimingConfig {
  const d = defaultTimingConfig()
  if (!raw) return d
  return {
    wordsPerMin: raw.wordsPerMin && raw.wordsPerMin > 0 ? raw.wordsPerMin : d.wordsPerMin,
    sessionMinutes: raw.sessionMinutes && raw.sessionMinutes > 0 ? raw.sessionMinutes : d.sessionMinutes,
    overrides: raw.overrides && typeof raw.overrides === 'object' ? raw.overrides : {},
  }
}
