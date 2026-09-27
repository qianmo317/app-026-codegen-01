import { describe, expect, it, vi } from 'vitest'
import type { Script } from '../../src/types'
import { computeTiming, splitRehearsals, defaultTimingConfig } from '../../src/engine/timing'
import type { TimingConfig } from '../../src/engine/timing'
import { planToCsv, planToTxt, sessionsToCsv, sessionsToTxt, exportPlan } from '../../src/engine/export'
import { parseScriptText } from '../../src/engine/parse'

const RAW = '## 第一场\n生：听罢言来吃一惊【停顿3】\n旦：转过了前排【过门4】\n\n## 第二场\n生：拼却乌纱不做官'

function buildScript(): Script {
  const { lines, segments } = parseScriptText(RAW)
  // 剧名故意含逗号与引号，用于验证 CSV 转义
  return { id: 'sc_x', title: '文,昭关"一', troupe: '某剧团', lines, segments, style: 'opera', updatedAt: 0 }
}

describe('计划表导出', () => {
  it('TXT 含表头、总时长、每段行与累计用时', () => {
    const script = buildScript()
    const cfg = defaultTimingConfig()
    const { segments, totalSeconds } = computeTiming(script, cfg)
    const txt = planToTxt(script, segments, totalSeconds, cfg)
    expect(txt).toContain('《文,昭关"一》排戏时长计划表')
    expect(txt).toContain('念白速度：180 字/分钟')
    expect(txt).toContain('第一场')
    expect(txt).toContain('第二场')
    expect(txt).toContain('段序')
    expect(txt).toContain('累计用时')
  })

  it('手工改写段在 TXT 中标注「手工改写」，其余标「估算」', () => {
    const script = buildScript()
    const cfg: TimingConfig = { ...defaultTimingConfig(), overrides: { [script.segments[0].id]: 100 } }
    const { segments, totalSeconds } = computeTiming(script, cfg)
    const txt = planToTxt(script, segments, totalSeconds, cfg)
    expect(txt).toContain('手工改写')
    expect(txt).toContain('估算')
    // 改写后总时长应为 100s + 第二段估算
    expect(txt).toContain('整场总用时：1:42')
  })

  it('CSV 带 BOM、表头行，并对含逗号/引号的字段做转义', () => {
    const script = buildScript()
    const cfg = defaultTimingConfig()
    const { segments, totalSeconds } = computeTiming(script, cfg)
    const csv = planToCsv(script, segments, totalSeconds, cfg)
    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv).toContain('段序,段名,句数,字数,停顿(秒),段用时,累计用时,口径')
    // 剧名含逗号与引号 → 整字段被双引号包裹，内部引号成对转义
    expect(csv).toContain('"《文,昭关""一》排戏时长计划表"')
    // 每段数据行：序号起头
    expect(csv).toMatch(/(^|\r\n)1,第一场,2,/)
    expect(csv).toMatch(/(^|\r\n)2,第二场,1,/)
  })
})

describe('切分表导出', () => {
  it('TXT 每次列出起止与「下次从…起」，最后一次为排练完毕', () => {
    const script = buildScript()
    const cfg: TimingConfig = { ...defaultTimingConfig(), sessionMinutes: 0.02 } // 1.2s，必切成多次
    const { segments } = computeTiming(script, cfg)
    const sessions = splitRehearsals(segments, cfg.sessionMinutes)
    expect(sessions.length).toBeGreaterThan(1)
    const txt = sessionsToTxt(script, segments, sessions, cfg)
    expect(txt).toContain('第 1 次')
    expect(txt).toContain('起：第1段')
    expect(txt).toContain('→ 下次从')
    expect(txt).toContain('全剧排练完毕')
  })

  it('整段结束时 TXT 标注「结束（全段完）」', () => {
    const script = buildScript()
    const cfg: TimingConfig = { ...defaultTimingConfig(), sessionMinutes: 90 }
    const { segments } = computeTiming(script, cfg)
    const sessions = splitRehearsals(segments, cfg.sessionMinutes)
    const txt = sessionsToTxt(script, segments, sessions, cfg)
    expect(sessions).toHaveLength(1)
    expect(txt).toContain('第二场')
    expect(txt).toContain('结束（全段完）')
  })

  it('CSV 含每次行与总次数', () => {
    const script = buildScript()
    const cfg = defaultTimingConfig()
    const { segments } = computeTiming(script, cfg)
    const sessions = splitRehearsals(segments, cfg.sessionMinutes)
    const csv = sessionsToCsv(script, segments, sessions, cfg)
    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv).toContain('第几次,从哪里起,练到哪里,句数,本次用时,备注')
    expect(csv).toContain('第1次')
    expect(csv).toContain(`共 ${sessions.length} 次`)
  })
})

describe('浏览器下载', () => {
  it('exportPlan 触发 Blob 下载且为 CSV MIME', () => {
    const script = buildScript()
    const cfg = defaultTimingConfig()
    const { segments, totalSeconds } = computeTiming(script, cfg)

    const click = vi.fn()
    const createURL = vi.fn<(obj: Blob) => string>(() => 'blob:mock')
    const origCreate = URL.createObjectURL
    const origRevoke = URL.revokeObjectURL
    URL.createObjectURL = createURL
    URL.revokeObjectURL = vi.fn()
    const origAppend = document.body.appendChild.bind(document.body)
    const origRemove = HTMLAnchorElement.prototype.remove
    HTMLAnchorElement.prototype.remove = function () { /* 简化：jsdom 中无需真实移除 */ }
    document.body.appendChild = function (node: Node) {
      ;(node as HTMLAnchorElement).click = click as unknown as () => void
      return node as never
    }

    try {
      exportPlan(script, segments, totalSeconds, cfg, 'csv')
      expect(createURL).toHaveBeenCalledTimes(1)
      expect(click).toHaveBeenCalledTimes(1)
      const blob = createURL.mock.calls[0]![0]
      expect(blob.type).toContain('text/csv')
    } finally {
      URL.createObjectURL = origCreate
      URL.revokeObjectURL = origRevoke
      document.body.appendChild = origAppend
      HTMLAnchorElement.prototype.remove = origRemove
    }
  })
})
