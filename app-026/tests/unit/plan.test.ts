import { describe, expect, it } from 'vitest'
import { buildScriptFromText } from '../../src/engine/parse'
import {
  buildPlan,
  spokenCount,
  formatClock,
  sessionRangeText,
  planToCSV,
  planToText,
  normalizePlanConfig,
} from '../../src/engine/plan'
import type { Script } from '../../src/types'

/** 解析一段文稿，返回 Script（默认空行分段） */
function makeScript(raw: string): Script {
  return buildScriptFromText('测试剧', raw, 'opera')
}

describe('念白字数', () => {
  it('汉字逐字计数，标点空白不计', () => {
    expect(spokenCount('杨延辉坐宫院，自思自叹！')).toBe(10)
    expect(spokenCount('  听罢 言来… ')).toBe(4)
  })

  it('连续字母/数字按词计数', () => {
    expect(spokenCount('行动 A 组 call 911 now')).toBe(7) // 行动(2)+A(1)+组(1)+call(1)+911(1)+now(1)
  })

  it('标记被解析器剥离后不计数', () => {
    const s = makeScript('生：唱句【过门5】再唱【锣鼓】')
    expect(s.lines[0].text).not.toContain('【')
    // 解析器以空格替换标记：唱句 + 再唱 = 4 字
    expect(spokenCount(s.lines[0].text)).toBe(4)
  })
})

describe('逐句/逐段用时估算', () => {
  it('每句 = 字数÷速度×60 + 句中停顿', () => {
    // 60 字/分钟 → 1 字 1 秒
    const s = makeScript('生：三个字【停顿3】')
    const plan = buildPlan(s, { charsPerMinute: 60 })
    expect(plan.segments[0].lines[0]).toMatchObject({
      chars: 3,
      speakSeconds: 3,
      pauseSeconds: 3,
      seconds: 6,
    })
  })

  it('过门/锣鼓/停顿都计入句中停顿，注不计', () => {
    const s = makeScript(
      '生：第一句【过门:6】\n\n生：第二句【锣鼓】\n\n生：第三句【停顿4】\n\n生：第四句【注:瞪眼】',
    )
    const plan = buildPlan(s, { charsPerMinute: 60 })
    const pauses = plan.segments.map((seg) => seg.pauseSeconds)
    expect(pauses).toEqual([6, 2, 4, 0]) // 锣鼓默认 2s
    expect(plan.totalPauseSeconds).toBe(12)
  })

  it('按段累加出整场总时长（累计用时）', () => {
    const s = makeScript('## 甲\n生：一二三四五六七八九十\n\n## 乙\n生：一二三四五六七八九十')
    const plan = buildPlan(s, { charsPerMinute: 60 })
    expect(plan.segments).toHaveLength(2)
    expect(plan.totalSeconds).toBeCloseTo(20, 5)
    expect(plan.segments[0].cumulativeSeconds).toBeCloseTo(10, 5)
    expect(plan.segments[1].cumulativeSeconds).toBeCloseTo(20, 5)
  })

  it('默认速度 120 字/分钟（半秒一字）', () => {
    const s = makeScript('生：一二三四五六七八九十')
    const plan = buildPlan(s)
    expect(plan.charsPerMinute).toBe(120)
    expect(plan.totalSeconds).toBeCloseTo(5, 5)
    expect(normalizePlanConfig(undefined).charsPerMinute).toBe(120)
  })
})

describe('手工改写段用时', () => {
  it('改写后整段与总时长取改写值，累计跟着重算', () => {
    const s = makeScript('## 甲\n生：一二三四五六七八九十\n\n## 乙\n生：一二三四五六七八九十')
    const plan = buildPlan(s, {
      charsPerMinute: 60,
      segmentCustomSeconds: { [s.segments[0].id]: 30 },
    })
    expect(plan.segments[0].seconds).toBe(30)
    expect(plan.segments[0].estimatedSeconds).toBeCloseTo(10, 5)
    expect(plan.segments[0].lines.every((l) => l.scaled)).toBe(true)
    expect(plan.totalSeconds).toBeCloseTo(40, 5)
    expect(plan.segments[1].cumulativeSeconds).toBeCloseTo(40, 5)
  })

  it('清空改写恢复估算', () => {
    const s = makeScript('生：一二三四五六七八九十')
    const overridden = buildPlan(s, { charsPerMinute: 60, segmentCustomSeconds: { [s.segments[0].id]: 99 } })
    expect(overridden.totalSeconds).toBe(99)
    const restored = buildPlan(s, { charsPerMinute: 60, segmentCustomSeconds: {} })
    expect(restored.totalSeconds).toBeCloseTo(10, 5)
  })

  it('改写为 0 秒合法（纯过场段）', () => {
    const s = makeScript('## 甲\n生：一二三四五六七八九十\n\n## 乙\n生：一二三四五六七八九十')
    const plan = buildPlan(s, { charsPerMinute: 60, segmentCustomSeconds: { [s.segments[0].id]: 0 } })
    expect(plan.segments[0].seconds).toBe(0)
    expect(plan.totalSeconds).toBeCloseTo(10, 5)
  })
})

describe('排练切分', () => {
  // 60 字/分下每句恰 10 秒；第一段 2 句(20s)、第二段 3 句(30s)、第三段 1 句(10s)
  const L = '生：一二三四五六七八九十'
  const RAW =
    `## 第一段\n${L}\n${L}\n\n` +
    `## 第二段\n${L}\n${L}\n${L}\n\n` +
    `## 第三段\n${L}`

  it('按上限顺序贪心切分，标出练到哪段第几句、下次从哪起', () => {
    const s = makeScript(RAW)
    const plan = buildPlan(s, { charsPerMinute: 60, sessionMinutes: 0.5 }) // 上限 30 秒
    expect(plan.sessions).toHaveLength(2)

    const [a, b] = plan.sessions
    expect(a.seconds).toBeCloseTo(30, 5) // 第一段 20s + 第二段第 1 句 10s，装满 30s
    expect(a.endSegment).toBe(2)
    expect(a.endLine).toBe(1)
    expect(a.nextStart).toEqual({ segment: 2, line: 2 })

    expect(b.endSegment).toBe(3)
    expect(b.endLine).toBe(1)
    expect(b.nextStart).toBeNull()
  })

  it('整段恰好装满时不拆段', () => {
    const s = makeScript(RAW)
    const plan = buildPlan(s, { charsPerMinute: 60, sessionMinutes: 1 }) // 60 秒，总 60 秒
    expect(plan.sessions).toHaveLength(1)
    expect(plan.sessions[0].truncated).toBe(false)
  })

  it('单段比一次还长 → 在段内按句拆，下次起点定位到句', () => {
    const s = makeScript(`## 长段\n${L}\n${L}\n${L}`)
    const plan = buildPlan(s, { charsPerMinute: 60, sessionMinutes: 0.4 }) // 上限 24 秒，每句 10 秒
    expect(plan.sessions).toHaveLength(2)
    expect(plan.sessions[0].endSegment).toBe(1)
    expect(plan.sessions[0].endLine).toBe(2) // 装两句
    expect(plan.sessions[0].truncated).toBe(true)
    expect(plan.sessions[1].startSegment).toBe(1)
    expect(plan.sessions[1].startLine).toBe(3)
    expect(plan.sessions[1].endLine).toBe(3)
    expect(plan.sessions[1].nextStart).toBeNull()
  })

  it('单句就超过上限也只占一次，不死循环', () => {
    const s = makeScript(`${L}\n${L}`)
    const plan = buildPlan(s, { charsPerMinute: 60, sessionMinutes: 0.1 }) // 6 秒 < 单句 10 秒
    expect(plan.sessions).toHaveLength(2)
    expect(plan.sessions[0].endLine).toBe(1)
    expect(plan.sessions[0].nextStart).toEqual({ segment: 1, line: 2 })
  })

  it('不设上限时整场一次过', () => {
    const s = makeScript(RAW)
    const plan = buildPlan(s, { charsPerMinute: 60 })
    expect(plan.sessions).toHaveLength(1)
    expect(plan.sessions[0].endSegment).toBe(3)
  })

  it('手工改写后切分跟着重算', () => {
    const s = makeScript(RAW)
    // 第一段改成 60 秒（两句各摊 30s）：上限 30 秒时第一段自己就要拆
    const plan = buildPlan(s, {
      charsPerMinute: 60,
      sessionMinutes: 0.5,
      segmentCustomSeconds: { [s.segments[0].id]: 60 },
    })
    expect(plan.sessions[0].endSegment).toBe(1)
    expect(plan.sessions[0].endLine).toBe(1)
    expect(plan.sessions[0].truncated).toBe(true)
    expect(plan.sessions[1].startSegment).toBe(1)
    expect(plan.sessions[1].startLine).toBe(2)
  })

  it('每次切分覆盖全场：各次秒数合计 = 整场总时长', () => {
    const s = makeScript(RAW)
    const plan = buildPlan(s, { charsPerMinute: 60, sessionMinutes: 0.35 })
    expect(plan.sessions.reduce((sum, x) => sum + x.seconds, 0)).toBeCloseTo(plan.totalSeconds, 5)
    // 最后一次 nextStart 为 null，其余都有续点
    plan.sessions.forEach((x, i) => {
      expect(x.nextStart === null).toBe(i === plan.sessions.length - 1)
    })
  })

  it('起止描述文案', () => {
    const s = makeScript(RAW)
    const plan = buildPlan(s, { charsPerMinute: 60, sessionMinutes: 0.5 })
    expect(sessionRangeText(plan.sessions[0])).toBe('第 1 段 第 1 句 → 第 2 段 第 1 句')
    expect(sessionRangeText(plan.sessions[1])).toBe('第 2 段 第 2 句 → 第 3 段 第 1 句')
  })
})

describe('格式化与导出', () => {
  it('formatClock：不足 1 小时 m:ss，超过 h:mm:ss', () => {
    expect(formatClock(0)).toBe('0:00')
    expect(formatClock(65)).toBe('1:05')
    expect(formatClock(3725)).toBe('1:02:05')
  })

  it('TXT 计划表含段序/段名/句数/用时/累计与切分信息', () => {
    const s = makeScript('## 甲\n生：一二三四五六七八九十\n\n## 乙\n生：一二三四五六七八九十')
    const txt = planToText(buildPlan(s, { charsPerMinute: 60, sessionMinutes: 0.1 }), s)
    expect(txt).toContain('排戏计划表《测试剧》')
    expect(txt).toContain('甲')
    expect(txt).toContain('乙')
    expect(txt).toContain('累计')
    expect(txt).toContain('第 1 次')
    expect(txt).toContain('下次从第')
  })

  it('CSV 带 BOM、表头与每行段序', () => {
    const s = makeScript('## 甲\n生：十个字的句子啊啊啊')
    const csv = planToCSV(buildPlan(s, { charsPerMinute: 60 }), s)
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv).toContain('段序,段名,句数')
    expect(csv).toContain('甲')
    expect(csv).toMatch(/^1,甲,/m)
  })
})

describe('空文稿与异常输入', () => {
  it('空文稿不产生排练次、总时长 0', () => {
    const s = makeScript('   \n  \n')
    const plan = buildPlan(s, { charsPerMinute: 120, sessionMinutes: 60 })
    expect(plan.totalSeconds).toBe(0)
    expect(plan.sessions).toEqual([])
  })

  it('非法速度回退默认值', () => {
    const s = makeScript('生：十个字的句子啊啊啊')
    const plan = buildPlan(s, { charsPerMinute: 0 })
    expect(plan.charsPerMinute).toBe(120)
  })
})
