import type { Script } from '../types'
import type { RehearsalSession, SegmentTiming, TimingConfig } from './timing'
import { formatClock, formatDurationCN } from './timing'

/**
 * 计划表 / 排练切分表导出：纯文本（.txt）与 CSV（.csv，带 BOM，Excel 可直接打开）。
 * 纯前端，走 Blob + a[download]，不落服务器。
 */

function csvEscape(value: string | number): string {
  const s = String(value)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const BOM = '﻿'

function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60) || '排戏计划'
}

/** 该次排练的终点是否正好是某段最后一句（= 整段练完） */
function endsAtSegmentEnd(s: RehearsalSession, timings: SegmentTiming[]): boolean {
  const seg = timings.find((t) => t.index === s.endSegmentIndex)
  return s.endSentenceNo === (seg?.sentenceCount ?? -1)
}

/** 字符串显示宽度：汉字/全角符号算 2，其余算 1 */
function displayWidth(s: string): number {
  let w = 0
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0
    w += code > 0x2e7f ? 2 : 1
  }
  return w
}

/** 按显示宽度在右侧补空格（中文等宽对齐） */
function padEndW(s: string, width: number): string {
  const gap = width - displayWidth(s)
  return s + (gap > 0 ? ' '.repeat(gap) : '')
}

/* ------------------------- 计划表 ------------------------- */

export function planToCsv(script: Script, timings: SegmentTiming[], totalSeconds: number, cfg: TimingConfig): string {
  const rows: string[] = []
  rows.push([`《${script.title}》排戏时长计划表`].map(csvEscape).join(','))
  rows.push([`念白速度 ${cfg.wordsPerMin} 字/分钟`, `整场总用时 ${formatClock(totalSeconds)}（${formatDurationCN(totalSeconds)}）`].map(csvEscape).join(','))
  rows.push(['段序', '段名', '句数', '字数', '停顿(秒)', '段用时', '累计用时', '口径'].map(csvEscape).join(','))
  for (const t of timings) {
    rows.push(
      [
        t.index,
        t.title,
        t.sentenceCount,
        t.words,
        Math.round(t.pauseSeconds * 10) / 10,
        formatClock(t.effectiveSeconds),
        formatClock(t.cumulativeSeconds),
        t.overridden ? '手工改写' : '估算',
      ]
        .map(csvEscape)
        .join(','),
    )
  }
  return BOM + rows.join('\r\n') + '\r\n'
}

export function planToTxt(script: Script, timings: SegmentTiming[], totalSeconds: number, cfg: TimingConfig): string {
  const lines: string[] = []
  lines.push(`《${script.title}》排戏时长计划表`)
  lines.push(`念白速度：${cfg.wordsPerMin} 字/分钟`)
  lines.push(`整场总用时：${formatClock(totalSeconds)}（约 ${formatDurationCN(totalSeconds)}）`)
  lines.push('')
  const cols: { head: string; width: number }[] = [
    { head: '段序', width: 5 },
    { head: '段名', width: 18 },
    { head: '句数', width: 5 },
    { head: '字数', width: 5 },
    { head: '段用时', width: 9 },
    { head: '累计用时', width: 9 },
    { head: '口径', width: 8 },
  ]
  lines.push(cols.map((c) => padEndW(c.head, c.width)).join(''))
  lines.push('─'.repeat(cols.reduce((s, c) => s + c.width, 0)))
  for (const t of timings) {
    const row = [
      padEndW(String(t.index), 5),
      padEndW(t.title.slice(0, 9), 18),
      padEndW(String(t.sentenceCount), 5),
      padEndW(String(t.words), 5),
      padEndW(formatClock(t.effectiveSeconds), 9),
      padEndW(formatClock(t.cumulativeSeconds), 9),
      padEndW(t.overridden ? '手工改写' : '估算', 8),
    ]
    lines.push(row.join(''))
  }
  return lines.join('\n') + '\n'
}

/* ------------------------- 切分表 ------------------------- */

export function sessionsToCsv(
  script: Script,
  timings: SegmentTiming[],
  sessions: RehearsalSession[],
  cfg: TimingConfig,
): string {
  const rows: string[] = []
  rows.push([`《${script.title}》排练切分表`].map(csvEscape).join(','))
  rows.push([`每次排练上限 ${cfg.sessionMinutes} 分钟`, `共 ${sessions.length} 次`].map(csvEscape).join(','))
  rows.push(['第几次', '从哪里起', '练到哪里', '句数', '本次用时', '备注'].map(csvEscape).join(','))
  for (const s of sessions) {
    const endWhole = endsAtSegmentEnd(s, timings)
    const start = `第${s.startSegmentIndex}段《${s.startSegmentTitle}》第${s.startSentenceNo}句`
    const end = endWhole
      ? `第${s.endSegmentIndex}段《${s.endSegmentTitle}》结束`
      : `第${s.endSegmentIndex}段《${s.endSegmentTitle}》第${s.endSentenceNo}句`
    rows.push(
      [
        `第${s.no}次`,
        start,
        end,
        s.sentenceCount,
        formatClock(s.seconds),
        s.overflow ? '有单句超出本次时长上限' : '',
      ]
        .map(csvEscape)
        .join(','),
    )
  }
  return BOM + rows.join('\r\n') + '\r\n'
}

export function sessionsToTxt(
  script: Script,
  timings: SegmentTiming[],
  sessions: RehearsalSession[],
  cfg: TimingConfig,
): string {
  const lines: string[] = []
  lines.push(`《${script.title}》排练切分表`)
  lines.push(`每次排练时长上限：${cfg.sessionMinutes} 分钟；共需 ${sessions.length} 次`)
  lines.push('')
  for (const s of sessions) {
    const endWhole = endsAtSegmentEnd(s, timings)
    lines.push(`第 ${s.no} 次（${formatClock(s.seconds)}，${s.sentenceCount} 句）`)
    lines.push(`  起：第${s.startSegmentIndex}段《${s.startSegmentTitle}》第${s.startSentenceNo}句`)
    lines.push(
      `  止：${
        endWhole
          ? `练到第${s.endSegmentIndex}段《${s.endSegmentTitle}》结束（全段完）`
          : `练到第${s.endSegmentIndex}段《${s.endSegmentTitle}》第${s.endSentenceNo}句`
      }`,
    )
    if (s.no < sessions.length) {
      const next = sessions[s.no] // no 从 1 起：第 1 次的下一次即数组第 1 项
      lines.push(`  → 下次从第${next.startSegmentIndex}段《${next.startSegmentTitle}》第${next.startSentenceNo}句起`)
    } else {
      lines.push('  → 全剧排练完毕')
    }
    if (s.overflow) lines.push('  ⚠ 有单句本身就超过时长上限，只能整句练')
    lines.push('')
  }
  return lines.join('\n')
}

/* ------------------------- 合一导出 ------------------------- */

export function exportPlan(script: Script, timings: SegmentTiming[], totalSeconds: number, cfg: TimingConfig, format: 'csv' | 'txt') {
  const content = format === 'csv' ? planToCsv(script, timings, totalSeconds, cfg) : planToTxt(script, timings, totalSeconds, cfg)
  download(`${safeName(script.title)}-时长计划表.${format}`, content, format === 'csv' ? 'text/csv' : 'text/plain')
}

export function exportSessions(
  script: Script,
  timings: SegmentTiming[],
  sessions: RehearsalSession[],
  cfg: TimingConfig,
  format: 'csv' | 'txt',
) {
  const content =
    format === 'csv' ? sessionsToCsv(script, timings, sessions, cfg) : sessionsToTxt(script, timings, sessions, cfg)
  download(`${safeName(script.title)}-排练切分表.${format}`, content, format === 'csv' ? 'text/csv' : 'text/plain')
}
