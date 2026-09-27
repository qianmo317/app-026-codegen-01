import { useEffect, useMemo, useState } from 'react'
import { Link } from '../router'
import { useScript } from '../state/hooks'
import type { Line } from '../types'
import {
  computeTiming,
  splitRehearsals,
  formatClock,
  formatDurationCN,
  normalizeConfig,
  defaultTimingConfig,
  DEFAULT_WORDS_PER_MIN,
  DEFAULT_SESSION_MINUTES,
} from '../engine/timing'
import type { SegmentTiming, TimingConfig } from '../engine/timing'
import { exportPlan, exportSessions } from '../engine/export'
import { Download, Pencil, RotateCcw, ChevronDown, ChevronRight, Clock3, Scissors } from 'lucide-react'

const LS_PREFIX = 'otp-timing-cfg:'

/** 按剧目持久化：念白速度、排练上限、手工改写的段用时（全本地，不上传） */
function loadCfg(scriptId: string): TimingConfig {
  try {
    const raw = localStorage.getItem(LS_PREFIX + scriptId)
    return raw ? normalizeConfig(JSON.parse(raw)) : defaultTimingConfig()
  } catch {
    return defaultTimingConfig()
  }
}

export function TimingPlan({ id }: { id: string }) {
  const { script } = useScript(id)
  const [cfg, setCfg] = useState<TimingConfig>(() => loadCfg(id))
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftMin, setDraftMin] = useState('')
  const [draftSec, setDraftSec] = useState('')
  const [openSegs, setOpenSegs] = useState<Set<string>>(new Set())

  useEffect(() => {
    setCfg(loadCfg(id))
  }, [id])
  useEffect(() => {
    try {
      localStorage.setItem(LS_PREFIX + id, JSON.stringify(cfg))
    } catch {
      /* 隐私模式等写入失败时忽略 */
    }
  }, [id, cfg])

  const { segments: timings, totalSeconds } = useMemo(() => {
    if (!script) return { segments: [] as SegmentTiming[], totalSeconds: 0 }
    return computeTiming(script, cfg)
  }, [script, cfg])

  const sessions = useMemo(() => splitRehearsals(timings, cfg.sessionMinutes), [timings, cfg.sessionMinutes])

  if (!script) return <div className="page center">加载中…</div>
  if (script.lines.length === 0) {
    return (
      <div className="page">
        <header className="page-head">
          <h1><Clock3 size={22} /> 排戏时长计划 · {script.title}</h1>
          <Link className="btn btn-ghost" to={`/script/${id}`}>返回编辑</Link>
        </header>
        <div className="panel"><p className="muted">还没有唱词。先到编辑页粘贴导入，再来估算时长。</p></div>
      </div>
    )
  }

  const lineById = new Map(script.lines.map((l) => [l.id, l] as const))

  const patchCfg = (p: Partial<TimingConfig>) => setCfg((c) => ({ ...c, ...p }))
  const setWpm = (v: number) => patchCfg({ wordsPerMin: v > 0 ? v : DEFAULT_WORDS_PER_MIN })
  const setSessionMin = (v: number) => patchCfg({ sessionMinutes: v > 0 ? v : DEFAULT_SESSION_MINUTES })

  const startEdit = (t: SegmentTiming) => {
    const total = Math.round(t.effectiveSeconds)
    setEditingId(t.segmentId)
    setDraftMin(String(Math.floor(total / 60)))
    setDraftSec(String(total % 60))
  }
  const confirmEdit = (segId: string) => {
    const m = Math.max(0, parseInt(draftMin || '0', 10) || 0)
    const s = Math.max(0, parseInt(draftSec || '0', 10) || 0)
    const seconds = m * 60 + s
    setCfg((c) => ({ ...c, overrides: { ...c.overrides, [segId]: seconds } }))
    setEditingId(null)
  }
  const resetOverride = (segId: string) => {
    setCfg((c) => {
      const overrides = { ...c.overrides }
      delete overrides[segId]
      return { ...c, overrides }
    })
  }

  const toggleSeg = (segId: string) => {
    setOpenSegs((prev) => {
      const next = new Set(prev)
      if (next.has(segId)) next.delete(segId)
      else next.add(segId)
      return next
    })
  }

  return (
    <div className="page">
      <header className="page-head">
        <h1><Clock3 size={22} /> 排戏时长计划 · {script.title}</h1>
        <div className="head-actions">
          <Link className="btn btn-ghost btn-small" to={`/script/${id}`}>返回编辑</Link>
          <Link className="btn btn-ghost btn-small" to={`/prompt/${id}`}>去排练</Link>
        </div>
      </header>

      {/* 参数设置 */}
      <section className="panel" data-testid="timing-settings">
        <div className="form-row timing-params">
          <label className="timing-field">
            念白速度
            <input
              data-testid="input-wpm"
              type="number"
              min={1}
              value={cfg.wordsPerMin}
              onChange={(e) => setWpm(parseInt(e.target.value, 10))}
            />
            <span className="muted">字 / 分钟</span>
          </label>
          <label className="timing-field">
            每次排练上限
            <input
              data-testid="input-session"
              type="number"
              min={1}
              value={cfg.sessionMinutes}
              onChange={(e) => setSessionMin(parseInt(e.target.value, 10))}
            />
            <span className="muted">分钟</span>
          </label>
          <div className="timing-total" data-testid="total-time">
            <span className="muted">整场总用时</span>
            <strong>{formatClock(totalSeconds)}</strong>
            <span className="muted">（约 {formatDurationCN(totalSeconds)}）</span>
          </div>
        </div>
        <p className="muted timing-hint">
          每句用时 = 字数 ÷ 念白速度 + 句中【停顿】【过门】【锣鼓】秒数；段用时逐句累加，整场逐段累加。
        </p>
      </section>

      {/* 计划表 */}
      <section className="panel">
        <div className="panel-head">
          <h2><Clock3 size={16} /> 时长计划表</h2>
          <div className="head-actions">
            <button className="btn btn-small btn-ghost" data-testid="btn-export-plan-txt" onClick={() => exportPlan(script, timings, totalSeconds, cfg, 'txt')}>
              <Download size={14} /> 计划表 TXT
            </button>
            <button className="btn btn-small btn-ghost" data-testid="btn-export-plan-csv" onClick={() => exportPlan(script, timings, totalSeconds, cfg, 'csv')}>
              <Download size={14} /> 计划表 CSV
            </button>
          </div>
        </div>
        <div className="table-wrap">
          <table className="timing-table" data-testid="plan-table">
            <thead>
              <tr>
                <th className="col-seg">段序</th>
                <th>段名</th>
                <th className="col-num">句数</th>
                <th className="col-num">字数</th>
                <th className="col-num">停顿</th>
                <th className="col-time">段用时</th>
                <th className="col-time">累计用时</th>
                <th>口径 / 改写</th>
              </tr>
            </thead>
            <tbody>
              {timings.map((t) => (
                <PlanRow
                  key={t.segmentId}
                  t={t}
                  lineById={lineById}
                  editing={editingId === t.segmentId}
                  draftMin={draftMin}
                  draftSec={draftSec}
                  open={openSegs.has(t.segmentId)}
                  onToggle={() => toggleSeg(t.segmentId)}
                  onStartEdit={() => startEdit(t)}
                  onConfirm={() => confirmEdit(t.segmentId)}
                  onCancel={() => setEditingId(null)}
                  onReset={() => resetOverride(t.segmentId)}
                  onDraftMin={setDraftMin}
                  onDraftSec={setDraftSec}
                />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 排练切分表 */}
      <section className="panel">
        <div className="panel-head">
          <h2><Scissors size={16} /> 排练切分（每次上限 {cfg.sessionMinutes} 分钟，共 {sessions.length} 次）</h2>
          <div className="head-actions">
            <button className="btn btn-small btn-ghost" data-testid="btn-export-session-txt" onClick={() => exportSessions(script, timings, sessions, cfg, 'txt')}>
              <Download size={14} /> 切分表 TXT
            </button>
            <button className="btn btn-small btn-ghost" data-testid="btn-export-session-csv" onClick={() => exportSessions(script, timings, sessions, cfg, 'csv')}>
              <Download size={14} /> 切分表 CSV
            </button>
          </div>
        </div>
        <div className="table-wrap">
          <table className="timing-table" data-testid="session-table">
            <thead>
              <tr>
                <th className="col-seg">第几次</th>
                <th>从哪起</th>
                <th>练到哪里</th>
                <th>下次从哪起</th>
                <th className="col-num">句数</th>
                <th className="col-time">本次用时</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s, i) => {
                const endWhole = s.endSentenceNo === (timings.find((t) => t.index === s.endSegmentIndex)?.sentenceCount ?? 0)
                const next = sessions[i + 1]
                return (
                  <tr key={s.no} data-testid="session-row">
                    <td>第 {s.no} 次{s.overflow && <span className="badge badge-warn" title="有单句本身就超过时长上限">单句超时</span>}</td>
                    <td>第{s.startSegmentIndex}段《{s.startSegmentTitle}》第{s.startSentenceNo}句</td>
                    <td>
                      {endWhole
                        ? <>第{s.endSegmentIndex}段《{s.endSegmentTitle}》<b>结束</b>（全段完）</>
                        : <>第{s.endSegmentIndex}段《{s.endSegmentTitle}》第{s.endSentenceNo}句</>}
                    </td>
                    <td className="muted">
                      {next
                        ? `第${next.startSegmentIndex}段《${next.startSegmentTitle}》第${next.startSentenceNo}句起`
                        : '—— 全剧排练完毕'}
                    </td>
                    <td className="col-num">{s.sentenceCount}</td>
                    <td className="col-time">{formatClock(s.seconds)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="muted timing-hint">按句顺序贪心装段、绝不拆句：再加一句就超时即收束本次。手工改写段用时后，本页总时长与切分自动重算。</p>
      </section>
    </div>
  )
}

interface PlanRowProps {
  t: SegmentTiming
  lineById: Map<string, Line>
  editing: boolean
  draftMin: string
  draftSec: string
  open: boolean
  onToggle: () => void
  onStartEdit: () => void
  onConfirm: () => void
  onCancel: () => void
  onReset: () => void
  onDraftMin: (v: string) => void
  onDraftSec: (v: string) => void
}

function PlanRow(props: PlanRowProps) {
  const { t, lineById, editing, draftMin, draftSec, open } = props
  return (
    <>
      <tr className={t.overridden ? 'row-overridden' : ''} data-testid="plan-row">
        <td className="col-seg">
          <button className="seg-toggle" data-testid="seg-toggle" onClick={props.onToggle} title="展开逐句明细">
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          {t.index}
        </td>
        <td className="cell-title">{t.title}</td>
        <td className="col-num">{t.sentenceCount}</td>
        <td className="col-num">{t.words}</td>
        <td className="col-num">{t.pauseSeconds > 0 ? `${Math.round(t.pauseSeconds)}s` : '—'}</td>
        <td className="col-time" data-testid="seg-duration">
          {editing ? (
            <span className="edit-time">
              <input
                data-testid="edit-min"
                type="number"
                min={0}
                value={draftMin}
                onChange={(e) => props.onDraftMin(e.target.value)}
              />
              分
              <input
                data-testid="edit-sec"
                type="number"
                min={0}
                max={59}
                value={draftSec}
                onChange={(e) => props.onDraftSec(e.target.value)}
              />
              秒
              <button className="btn btn-small" data-testid="edit-ok" onClick={props.onConfirm}>确定</button>
              <button className="btn btn-small btn-ghost" onClick={props.onCancel}>取消</button>
            </span>
          ) : (
            <b>{formatClock(t.effectiveSeconds)}</b>
          )}
        </td>
        <td className="col-time" data-testid="seg-cumulative">{formatClock(t.cumulativeSeconds)}</td>
        <td>
          <span className={`badge ${t.overridden ? 'badge-manual' : 'badge-est'}`}>
            {t.overridden ? '手工改写' : `估算 ${formatClock(t.estimatedSeconds)}`}
          </span>
          {!editing && (
            <button className="icon-btn" data-testid="btn-edit-seg" title="手工改写本段用时" onClick={props.onStartEdit}>
              <Pencil size={13} />
            </button>
          )}
          {t.overridden && !editing && (
            <button className="icon-btn" data-testid="btn-reset-seg" title="恢复估算" onClick={props.onReset}>
              <RotateCcw size={13} />
            </button>
          )}
        </td>
      </tr>
      {open && (
        <tr className="detail-row" data-testid="seg-detail">
          <td />
          <td colSpan={7}>
            <table className="line-table">
              <thead>
                <tr><th className="col-num">句</th><th>角色</th><th>唱词 / 台词</th><th className="col-num">字数</th><th className="col-num">停顿</th><th className="col-time">句用时</th></tr>
              </thead>
              <tbody>
                {t.lines.map((lt) => {
                  const line = lineById.get(lt.lineId)
                  return (
                    <tr key={lt.lineId}>
                      <td className="col-num">{lt.sentenceNo}</td>
                      <td className="muted">{line?.role ?? '—'}</td>
                      <td className="cell-text">{line?.text ?? ''}</td>
                      <td className="col-num">{lt.words}</td>
                      <td className="col-num">{lt.pauseSeconds > 0 ? `${Math.round(lt.pauseSeconds)}s` : '—'}</td>
                      <td className="col-time">{formatClock(lt.effectiveSeconds)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  )
}
