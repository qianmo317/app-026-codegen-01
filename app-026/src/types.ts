export type CueKind = 'pause' | 'interlude' | 'drum' | 'note'

export interface Cue {
  id: string
  kind: CueKind
  seconds?: number
  label?: string
}

export interface Line {
  id: string
  role?: string
  text: string
  cues: Cue[]
  marks: string[]
  note?: string
}

export interface Segment {
  id: string
  title: string
  lineIds: string[]
  loop?: boolean
}

export type ScriptStyle = 'opera' | 'speech'

/** 排戏计划设置（整剧一份）；段用时手工改写存到 segmentCustomSeconds，键为段 id */
export interface PlanConfig {
  /** 念白速度：每分钟多少字 */
  charsPerMinute: number
  /** 每次排练时长上限（分钟）；0 / 空表示不切分 */
  sessionMinutes: number
  /** 段 id → 手工改写的整段用时（秒） */
  segmentCustomSeconds: Record<string, number>
}

export interface Script {
  id: string
  title: string
  troupe?: string
  lines: Line[]
  segments: Segment[]
  style: ScriptStyle
  updatedAt: number
  plan?: PlanConfig
}

export type ThemeName = 'dark' | 'light' | 'highContrast'

export interface PromptSettings {
  fontSizePx: number
  autoFit: boolean
  autoScroll: boolean
  speedPxPerSec: number
  theme: ThemeName
  holdOnCue: boolean
  lockStage: boolean
}
