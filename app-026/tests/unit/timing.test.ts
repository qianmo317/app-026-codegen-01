import { describe, expect, it } from 'vitest'
import { parseScriptText } from '../../src/engine/parse'
import type { Script } from '../../src/types'
import {
  countWords,
  computeTiming,
  splitRehearsals,
  formatClock,
  formatDurationCN,
  defaultTimingConfig,
  normalizeConfig,
  DEFAULT_WORDS_PER_MIN,
} from '../../src/engine/timing'
import type { TimingConfig } from '../../src/engine/timing'

function buildScript(raw: string, title = '测试剧目'): Script {
  const { lines, segments } = parseScriptText(raw, { autoSegmentOnBlank: false })
  return { id: 'sc_test', title, troupe: '测试剧团', lines, segments, style: 'opera', updatedAt: 0 }
}

/** 180 字/分钟 → 每字 1/3 秒 */
const THIRD = 1 / 3

describe('字数统计', () => {
  it('汉字逐字计数、标点空格不计', () => {
    expect(countWords('听罢言来吃一惊，')).toBe(7)
    expect(countWords('好！！ …—')).toBe(1)
  })

  it('连续英文/数字串各算一个词', () => {
    // OK、app-026、123 三个词，走、见两个汉字
    expect(countWords('OK 走，app-026 见 123')).toBe(5)
  })

  it('空串为 0', () => {
    expect(countWords('')).toBe(0)
    expect(countWords('，。！？')).toBe(0)
  })
})

describe('逐句 / 逐段 / 整场计时', () => {
  it('句用时 = 念字用时 + 停顿秒数', () => {
    const script = buildScript('生：听罢言来吃一惊【停顿3】')
    const { segments } = computeTiming(script, defaultTimingConfig())
    expect(segments).toHaveLength(1)
    const lt = segments[0].lines[0]
    expect(lt.words).toBe(7)
    expect(lt.pauseSeconds).toBe(3)
    expect(lt.estimatedSeconds).toBeCloseTo(7 * THIRD + 3, 6)
  })

  it('过门/锣鼓也算停顿，批注【注:】不停留', () => {
    const script = buildScript('生：老娘亲来到白马关【过门:6】拼了【锣鼓】【注:瞪眼】')
    const { segments } = computeTiming(script, defaultTimingConfig())
    const lt = segments[0].lines[0]
    // 「老娘亲来到白马关」8 字 + 「拼了」2 字 = 10；过门 6s + 锣鼓默认 2s
    expect(lt.words).toBe(10)
    expect(lt.pauseSeconds).toBe(8)
    expect(lt.estimatedSeconds).toBeCloseTo(10 * THIRD + 8, 6)
  })

  it('段用时逐句累加、整场逐段累加并给出累计列', () => {
    const raw = '## 第一段\n生：你好呀【停顿1】\n旦：再见\n\n## 第二段\n生：好'
    const script = buildScript(raw)
    const { segments, totalSeconds } = computeTiming(script, defaultTimingConfig())
    expect(segments).toHaveLength(2)
    expect(segments[0].sentenceCount).toBe(2)
    expect(segments[0].words).toBe(5)
    expect(segments[0].pauseSeconds).toBe(1)
    expect(segments[0].estimatedSeconds).toBeCloseTo(5 * THIRD + 1, 6)
    expect(segments[1].index).toBe(2)
    expect(segments[1].cumulativeSeconds).toBeCloseTo(totalSeconds, 6)
    expect(segments[0].cumulativeSeconds).toBeCloseTo(segments[0].effectiveSeconds, 6)
  })

  it('空行自动分段被关掉时，## 标题仍切段', () => {
    const script = buildScript('## 头段\n生：甲\n## 二段\n旦：乙')
    const { segments } = computeTiming(script, defaultTimingConfig())
    expect(segments.map((s) => s.title)).toEqual(['头段', '二段'])
  })

  it('段序连续、空段不编号', () => {
    // 手工构造：空段夹在两个有效段之间
    const script: Script = {
      id: 'sc0',
      title: '空段',
      lines: [
        { id: 'l1', text: '甲', cues: [], marks: [] },
        { id: 'l2', text: '乙', cues: [], marks: [] },
      ],
      segments: [
        { id: 'a', title: '甲段', lineIds: ['l1'] },
        { id: 'empty', title: '空段', lineIds: [] },
        { id: 'b', title: '乙段', lineIds: ['l2'] },
      ],
      style: 'opera',
      updatedAt: 0,
    }
    const { segments } = computeTiming(script, defaultTimingConfig())
    expect(segments.map((s) => s.index)).toEqual([1, 2])
    expect(segments.map((s) => s.title)).toEqual(['甲段', '乙段'])
  })

  it('速度越快用时越短', () => {
    const script = buildScript('生：一二三四五六七八九十')
    const slow = computeTiming(script, { ...defaultTimingConfig(), wordsPerMin: 60 }).totalSeconds
    const fast = computeTiming(script, { ...defaultTimingConfig(), wordsPerMin: 300 }).totalSeconds
    expect(fast).toBeLessThan(slow)
    expect(slow).toBeCloseTo(10, 6) // 60字/分 → 10字 = 10s
  })
})

describe('手工改写段用时', () => {
  it('改写后整段与整场总时长重算，并标记 overridden', () => {
    const raw = '## 第一段\n生：你好呀\n旦：早上好啊\n\n## 第二段\n生：好'
    const script = buildScript(raw)
    const seg1Id = script.segments[0].id
    const cfg: TimingConfig = { ...defaultTimingConfig(), overrides: { [seg1Id]: 120 } }
    const { segments, totalSeconds } = computeTiming(script, cfg)

    expect(segments[0].overridden).toBe(true)
    expect(segments[0].effectiveSeconds).toBe(120)
    expect(segments[0].estimatedSeconds).not.toBe(120)
    expect(segments[1].overridden).toBe(false)
    expect(totalSeconds).toBeCloseTo(120 + segments[1].estimatedSeconds, 6)
    expect(segments[1].cumulativeSeconds).toBeCloseTo(totalSeconds, 6)
  })

  it('改写秒数按各句估算比例摊到句，句合计 = 改写值', () => {
    // 不带角色前缀，避免前缀字数干扰：第一句 1 字、第二句 6 字
    const raw = '## 段\n一\n二二二二二二'
    const script = buildScript(raw)
    const segId = script.segments[0].id
    const cfg: TimingConfig = { ...defaultTimingConfig(), overrides: { [segId]: 70 } }
    const { segments } = computeTiming(script, cfg)
    expect(segments[0].lines[0].words).toBe(1)
    expect(segments[0].lines[1].words).toBe(6)
    const sum = segments[0].lines.reduce((s, l) => s + l.effectiveSeconds, 0)
    expect(sum).toBeCloseTo(70, 6)
    const [a, b] = segments[0].lines
    expect(b.effectiveSeconds / a.effectiveSeconds).toBeCloseTo(6, 4)
    expect(a.effectiveSeconds).toBeCloseTo(10, 6)
    expect(b.effectiveSeconds).toBeCloseTo(60, 6)
  })

  it('整段估算为 0（无字无停顿）时手工值在各句间均摊', () => {
    // 手工构造：两句空文本、无停顿 → 估算 0，改写成 30s 应两句均分
    const script: Script = {
      id: 'sc0',
      title: '空',
      lines: [
        { id: 'l1', text: '', cues: [], marks: [] },
        { id: 'l2', text: '', cues: [], marks: [] },
      ],
      segments: [{ id: 'seg0', title: '段', lineIds: ['l1', 'l2'] }],
      style: 'opera',
      updatedAt: 0,
    }
    const cfg: TimingConfig = { ...defaultTimingConfig(), overrides: { seg0: 30 } }
    const { segments } = computeTiming(script, cfg)
    expect(segments[0].estimatedSeconds).toBe(0)
    expect(segments[0].lines[0].effectiveSeconds).toBeCloseTo(15, 6)
    expect(segments[0].lines[1].effectiveSeconds).toBeCloseTo(15, 6)
  })

  it('删除改写恢复估算', () => {
    const script = buildScript('生：你好呀')
    const segId = script.segments[0].id
    const overridden = computeTiming(script, {
      ...defaultTimingConfig(),
      overrides: { [segId]: 100 },
    })
    expect(overridden.totalSeconds).toBe(100)
    const reset = computeTiming(script, defaultTimingConfig())
    expect(reset.totalSeconds).toBeCloseTo(3 * THIRD, 6)
  })
})

describe('排练切分', () => {
  it('按上限顺序装句、不拆句，标出练到哪 / 下次从哪起', () => {
    // 6 句，每句 5 字 = 5/3 s ≈ 1.67s（180字/分）
    const raw = ['生：句一五个字呀', '生：句二五个字呀', '生：句三五个字呀', '生：句四五个字呀', '生：句五五个字呀', '生：句六五个字呀'].join('\n')
    const script = buildScript(raw)
    const { segments: timings } = computeTiming(script, defaultTimingConfig())
    // 上限 0.05 分钟 = 3s → 每次只能装 1 句（1.67s），第 2 句就 3.33 > 3
    const sessions = splitRehearsals(timings, 0.05)
    expect(sessions).toHaveLength(6)
    expect(sessions[0].startSentenceNo).toBe(1)
    expect(sessions[0].endSentenceNo).toBe(1)
    expect(sessions[1].startSentenceNo).toBe(2)
    expect(sessions[0].overflow).toBe(false)
    expect(sessions[5].endSentenceNo).toBe(6)
  })

  it('段边界清晰：一次结束在整段末尾时下次从下一段第 1 句起', () => {
    const raw = '## 一\n生：你好\n生：再见\n\n## 二\n生：好呀'
    const script = buildScript(raw)
    const { segments: timings } = computeTiming(script, defaultTimingConfig())
    // 段一约 4字*1/3≈1.33s；上限 0.025 分钟 = 1.5s 刚好装下段一两句
    const sessions = splitRehearsals(timings, 0.025)
    expect(sessions).toHaveLength(2)
    expect(sessions[0].endSegmentIndex).toBe(1)
    expect(sessions[0].endSentenceNo).toBe(2)
    expect(sessions[1].startSegmentIndex).toBe(2)
    expect(sessions[1].startSentenceNo).toBe(1)
  })

  it('单次上限足够大时整场一次过', () => {
    const script = buildScript('生：你好呀\n旦：再见啦')
    const { segments: timings } = computeTiming(script, defaultTimingConfig())
    const sessions = splitRehearsals(timings, 90)
    expect(sessions).toHaveLength(1)
    expect(sessions[0].sentenceCount).toBe(2)
    expect(sessions[0].startSegmentIndex).toBe(1)
    expect(sessions[0].endSegmentIndex).toBe(1)
  })

  it('单句超过上限时独占一次并标记 overflow', () => {
    const script = buildScript('生：你好呀') // 3 字 ≈ 1s
    const { segments: timings } = computeTiming(script, defaultTimingConfig())
    const sessions = splitRehearsals(timings, 0.001) // 0.06s 上限
    expect(sessions).toHaveLength(1)
    expect(sessions[0].overflow).toBe(true)
  })

  it('手工改写段用时后切分跟着变（长段被拆成多次）', () => {
    const raw = '## 一\n生：你好\n\n## 二\n生：好'
    const script = buildScript(raw)
    const seg1 = script.segments[0].id
    const before = splitRehearsals(computeTiming(script, defaultTimingConfig()).segments, 1) // 60s
    expect(before).toHaveLength(1)
    const cfg: TimingConfig = { ...defaultTimingConfig(), overrides: { [seg1]: 90 } }
    const after = splitRehearsals(computeTiming(script, cfg).segments, 1)
    expect(after.length).toBeGreaterThan(1)
    expect(after[0].seconds).toBe(90)
  })

  it('每次用时之和等于整场总用时', () => {
    const raw = '## 一\n生：你好呀\n旦：早上好\n\n## 二\n生：锣鼓喧天【锣鼓】'
    const script = buildScript(raw)
    const { segments: timings, totalSeconds } = computeTiming(script, defaultTimingConfig())
    const sessions = splitRehearsals(timings, 0.05) // 3s
    const sum = sessions.reduce((s, x) => s + x.seconds, 0)
    expect(sum).toBeCloseTo(totalSeconds, 6)
  })
})

describe('格式化与配置', () => {
  it('formatClock 秒→mm:ss / h:mm:ss', () => {
    expect(formatClock(0)).toBe('0:00')
    expect(formatClock(65.4)).toBe('1:05')
    expect(formatClock(3725)).toBe('1:02:05')
  })

  it('formatDurationCN 自然语言', () => {
    expect(formatDurationCN(5)).toBe('5秒')
    expect(formatDurationCN(65)).toBe('1分5秒')
    expect(formatDurationCN(120)).toBe('2分')
    expect(formatDurationCN(3700)).toBe('1小时1分')
    expect(formatDurationCN(3600)).toBe('1小时')
  })

  it('normalizeConfig 对坏值回退默认', () => {
    const c = normalizeConfig({ wordsPerMin: -1, sessionMinutes: 0, overrides: { x: 10 } })
    expect(c.wordsPerMin).toBe(DEFAULT_WORDS_PER_MIN)
    expect(c.sessionMinutes).toBe(90)
    expect(c.overrides).toEqual({ x: 10 })
    expect(normalizeConfig(null).wordsPerMin).toBe(DEFAULT_WORDS_PER_MIN)
  })
})
