import { Link } from '../router'
import { useScript } from '../state/hooks'
import {
  buildPlan,
  formatClock,
  formatDuration,
  sessionRangeText,
  planToText,
  planToCSV,
  downloadPlanFile,
  normalizePlanConfig,
  pruneOverrides,
} from '../engine/plan'
import type { PlanConfig } from '../types'
import { ArrowLeft, FileSpreadsheet, FileText, Play, RotateCcw, CalendarClock } from 'lucide-react'

export function Plan({ id }: { id: string }) {
  const { script, mutate, saved } = useScript(id)
  if (!script) return <div className="page center">加载中…</div>

  const config = normalizePlanConfig(script.plan)
  const plan = buildPlan(script, config)

  const totalLines = plan.segments.reduce((s, x) => s + x.lineCount, 0)

  const patchConfig = (p: Partial<PlanConfig>) => {
    mutate((s) => {
      const merged: PlanConfig = { ...normalizePlanConfig(s.plan), ...p }
      merged.segmentCustomSeconds = pruneOverrides(s.segments, merged.segmentCustomSeconds)
      return { ...s, plan: merged }
    })
  }

  const setCustom = (segId: string, raw: string) => {
    mutate((s) => {
      const merged = normalizePlanConfig(s.plan)
      const overrides = { ...merged.segmentCustomSeconds }
      if (raw.trim() === '') {
        delete overrides[segId]
      } else {
        const v = parseFloat(raw)
        if (!Number.isFinite(v) || v < 0) return s
        overrides[segId] = v
      }
      merged.segmentCustomSeconds = pruneOverrides(s.segments, overrides)
      return { ...s, plan: merged }
    })
  }

  const resetOverride = (segId: string) => {
    mutate((s) => {
      const merged = normalizePlanConfig(s.plan)
      delete merged.segmentCustomSeconds[segId]
      return { ...s, plan: merged }
    })
  }

  const safeName = script.title.replace(/[\\/:*?"<>|\s]+/g, '_')
  const exportTxt = () =>
    downloadPlanFile(`${safeName}-排戏计划.txt`, planToText(plan, script), 'text/plain;charset=utf-8')
  const exportCsv = () =>
    downloadPlanFile(`${safeName}-排戏计划.csv`, planToCSV(plan, script), 'text/csv;charset=utf-8')

  return (
    <div className="page" data-testid="plan-page">
      <header className="page-head">
        <h1><CalendarClock size={22} /> 排戏计划 · {script.title}</h1>
        <div className="head-actions">
          <Link className="btn btn-ghost btn-small" to={`/script/${id}`}><ArrowLeft size={14} /> 返回编辑</Link>
          <Link className="btn btn-small" to={`/prompt/${id}`}><Play size={14} /> 去排练</Link>
          <span className="save-state" data-testid="save-state">{saved ? '已保存' : '保存中…'}</span>
        </div>
      </header>

      <section className="panel">
        <h2>估算参数</h2>
        <div className="plan-fields">
          <label className="plan-field">
            念白速度
            <input
              data-testid="plan-cpm"
              type="number"
              min={1}
              value={config.charsPerMinute}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10)
                if (Number.isFinite(v) && v > 0) patchConfig({ charsPerMinute: v })
              }}
            />
            <span className="muted">字 / 分钟</span>
          </label>
          <label className="plan-field">
            每次排练时长上限
            <input
              data-testid="plan-session-min"
              type="number"
              min={0}
              step={0.1}
              value={config.sessionMinutes || ''}
              placeholder="不切分"
              onChange={(e) => {
                const v = parseFloat(e.target.value)
                patchConfig({ sessionMinutes: Number.isFinite(v) && v > 0 ? v : 0 })
              }}
            />
            <span className="muted">分钟（留空 = 整场一次过）</span>
          </label>
          <span className="muted">每句用时 = 句中字数 ÷ 速度 × 60 + 句中停顿（过门/锣鼓/停顿标记）</span>
        </div>
        <div className="plan-summary" data-testid="plan-summary">
          <span><b>{plan.segmentCount}</b> 段</span>
          <span><b>{totalLines}</b> 句</span>
          <span><b>{plan.totalChars}</b> 字</span>
          <span>停顿合计 <b>{formatClock(plan.totalPauseSeconds)}</b></span>
          <span className="plan-total">整场总时长（估）<b>{formatDuration(plan.totalSeconds)}</b>（{formatClock(plan.totalSeconds)}）</span>
        </div>
      </section>

      <section className="panel">
        <div className="plan-table-head">
          <h2>计划表</h2>
          <div className="head-actions">
            <button className="btn btn-small btn-ghost" data-testid="btn-export-txt" onClick={exportTxt}>
              <FileText size={14} /> 导出 TXT
            </button>
            <button className="btn btn-small btn-ghost" data-testid="btn-export-csv" onClick={exportCsv}>
              <FileSpreadsheet size={14} /> 导出 CSV
            </button>
          </div>
        </div>
        {totalLines === 0 && <p className="muted">文稿还没有句子，先到编辑页粘贴唱词。</p>}
        <div className="table-wrap">
          <table className="plan-table" data-testid="plan-table">
            <thead>
              <tr>
                <th>段序</th>
                <th>段名</th>
                <th>句数</th>
                <th>字数</th>
                <th>停顿</th>
                <th>估算用时</th>
                <th>本段用时（可改写，秒）</th>
                <th>累计用时</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {plan.segments.map((seg) => (
                <tr key={seg.segmentId} data-testid="plan-row" data-custom={seg.custom !== undefined ? '1' : '0'}>
                  <td className="num">{seg.index + 1}</td>
                  <td className="seg-name">{seg.title}{seg.lineCount === 0 && <span className="muted">（空段）</span>}</td>
                  <td className="num">{seg.lineCount}</td>
                  <td className="num">{seg.chars}</td>
                  <td className="num">{formatClock(seg.pauseSeconds)}</td>
                  <td className="num muted" title="字数÷速度+停顿">{formatClock(seg.estimatedSeconds)}</td>
                  <td className="num">
                    <span className="plan-dur">
                      <input
                        className="plan-dur-input"
                        data-testid="plan-custom-input"
                        type="number"
                        min={0}
                        step={0.1}
                        placeholder={seg.estimatedSeconds.toFixed(1)}
                        value={seg.custom ?? ''}
                        onChange={(e) => setCustom(seg.segmentId, e.target.value)}
                      />
                      <span className="plan-dur-clock">{formatClock(seg.seconds)}</span>
                    </span>
                  </td>
                  <td className="num strong">{formatClock(seg.cumulativeSeconds)}</td>
                  <td>
                    {seg.custom !== undefined && (
                      <button
                        className="btn btn-small btn-ghost"
                        data-testid="plan-reset"
                        title="恢复按速度估算"
                        onClick={() => resetOverride(seg.segmentId)}
                      ><RotateCcw size={13} /></button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <h2>排练切分{config.sessionMinutes > 0 ? `（每次上限 ${config.sessionMinutes} 分钟）` : ''}</h2>
        {!config.sessionMinutes && <p className="muted">设定「每次排练时长上限」后，自动把整场切成若干次。</p>}
        {config.sessionMinutes > 0 && plan.sessions.length === 0 && <p className="muted">没有可排练的句子。</p>}
        <div className="session-list">
          {config.sessionMinutes > 0 && plan.sessions.map((s) => (
            <div className="session-card" key={s.no} data-testid="session-card" data-no={s.no}>
              <div className="session-no">第 {s.no} 次</div>
              <div className="session-body">
                <div className="session-range">{sessionRangeText(s)}{s.truncated && <span className="tag">段内拆分</span>}</div>
                <div className="session-detail muted">
                  练到第 {s.endSegment} 段第 {s.endLine} 句结束；
                  {s.nextStart
                    ? <>下次从第 <b>{s.nextStart.segment}</b> 段第 <b>{s.nextStart.line}</b> 句起</>
                    : '整场排完'}
                </div>
              </div>
              <div className="session-time">{formatClock(s.seconds)}</div>
            </div>
          ))}
        </div>
      </section>

      <p className="muted plan-tip">
        提示：某段实际排下来跟估算不一样时，直接改「本段用时」里的秒数——总时长与排练切分会立刻重算；清空输入框即恢复估算。参数随剧目保存在本机。
      </p>
    </div>
  )
}
