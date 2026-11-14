import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  confirmConversionCoverage,
  conversionCoverageHistory,
  listEntries,
  moduleMeta,
  previewConversionCoverage,
  publishConversionList,
} from '@/api/local-service'
import {
  formatPercent,
  parseSteps,
} from '@/data/conversion-coverage'
import type { CoveragePlan, CoverageVersion, DraftBinding } from '@/data/conversion-coverage'
import type { EntryRow } from '@/data/types'

const conversionMeta = moduleMeta('conversion')
const eventMeta = moduleMeta('eventdef')

type Props = {
  reloadList: () => void
  operator: string
}

// 事件发布驱动的步骤回写面板：选已发布事件 → 预览 → 确认，三步之内不落库。
export default function ConversionCoveragePanel({ reloadList, operator }: Props) {
  const [conversions, setConversions] = useState<EntryRow[]>([])
  const [events, setEvents] = useState<EntryRow[]>([])
  const [conversionCode, setConversionCode] = useState('CONV-0003')
  const [stepIndex, setStepIndex] = useState(3)
  const [primaryEventId, setPrimaryEventId] = useState('')
  const [alternateEventIds, setAlternateEventIds] = useState<string[]>([])
  const [plan, setPlan] = useState<CoveragePlan | null>(null)
  const [previewDraft, setPreviewDraft] = useState<DraftBinding | null>(null)
  const [history, setHistory] = useState<CoverageVersion[]>([])
  const [message, setMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

  const refresh = useCallback(() => {
    setConversions(listEntries('conversion').items)
    setEvents(listEntries('eventdef').items)
    setHistory(conversionCoverageHistory(conversionCode))
  }, [conversionCode])

  useEffect(() => {
    refresh()
  }, [refresh])

  const conversion = useMemo(
    () => conversions.find((row) => String(row['转化编号'] ?? '') === conversionCode),
    [conversions, conversionCode],
  )
  const steps = useMemo(() => (conversion ? parseSteps(conversion) : []), [conversion])
  const publishedEvents = useMemo(
    () => events.filter((row) => String(row.status) === '已发布'),
    [events],
  )

  function resetPreview() {
    setPlan(null)
    setPreviewDraft(null)
  }

  function draftBinding(): DraftBinding {
    return { stepIndex, primaryEventId, alternateEventIds }
  }

  function preview() {
    setErrorMessage('')
    setMessage('')
    const result = previewConversionCoverage(conversionCode, draftBinding())
    if (!result.ok || !result.plan) {
      setErrorMessage(result.message)
      setPlan(null)
      setPreviewDraft(null)
      return
    }
    setPlan(result.plan)
    setPreviewDraft(draftBinding())
    setMessage(result.message)
  }

  function confirm() {
    setErrorMessage('')
    setMessage('')
    if (!plan || !previewDraft) {
      setErrorMessage('请先预览步骤序列与缺失事件，确认后再回写')
      return
    }
    const result = confirmConversionCoverage(conversionCode, previewDraft, operator)
    if (!result.ok) {
      setErrorMessage(result.message)
      // 失败时预览保留，方便对照缺失项；但清单与覆盖状态都没有变。
      return
    }
    setMessage(result.message)
    resetPreview()
    refresh()
    reloadList()
  }

  function publish() {
    setErrorMessage('')
    setMessage('')
    const result = publishConversionList(conversionCode)
    if (!result.ok) {
      setErrorMessage(result.message)
      return
    }
    setMessage(result.message)
    refresh()
    reloadList()
  }

  const latestVersion = history[0] ?? null
  const publishGated = plan
    ? plan.canPublish
    : latestVersion !== null &&
      latestVersion.missingSteps.length === 0 &&
      latestVersion.sourceEventVersions.length > 0

  return (
    <article className="panel" data-testid="coverage-panel">
      <header className="panel-head">
        <div>
          <h3>事件回写转化步骤</h3>
          <p className="page-desc">
            为转化定义的每一步指定已发布埋点事件，先预览再确认；未发布事件只作为缺失项提示，不计入覆盖。
          </p>
        </div>
      </header>

      <div className="panel-controls">
        <label className="filter-item">
          <span>{conversionMeta.entity}</span>
          <select
            value={conversionCode}
            onChange={(event) => {
              setConversionCode(event.target.value)
              setStepIndex(1)
              setPrimaryEventId('')
              setAlternateEventIds([])
              resetPreview()
            }}
          >
            {conversions.map((row) => (
              <option key={String(row.id)} value={String(row['转化编号'])}>
                {String(row['转化编号'])} {String(row['转化名称'])}（{String(row.status)}）
              </option>
            ))}
          </select>
        </label>

        <label className="filter-item">
          <span>回写步骤</span>
          <select
            value={stepIndex}
            onChange={(event) => {
              setStepIndex(Number(event.target.value))
              resetPreview()
            }}
          >
            {steps.map((step) => (
              <option key={step.index} value={step.index}>
                第{step.index}步 {step.name}
              </option>
            ))}
          </select>
        </label>

        <label className="filter-item">
          <span>主事件（唯一计入覆盖）</span>
          <select
            value={primaryEventId}
            onChange={(event) => {
              setPrimaryEventId(event.target.value)
              setAlternateEventIds((prev) => prev.filter((id) => id !== event.target.value))
              resetPreview()
            }}
          >
            <option value="">请选择{eventMeta.entity}</option>
            {events.map((row) => {
              const eventId = String(row['事件编号'])
              const published = String(row.status) === '已发布'
              return (
                <option key={eventId} value={eventId}>
                  {eventId} {String(row['事件名称'])} · {String(row['采样比例'])} ·{' '}
                  {String(row['所属产品'])} · {String(row['事件版本'])}
                  {published ? '' : `（${String(row.status)}，不可计入）`}
                </option>
              )
            })}
          </select>
        </label>
      </div>

      <div className="panel-controls">
        <div className="filter-item">
          <span>备选事件（只提示，不重复计入）</span>
          <div className="check-list">
            {events
              .filter((row) => String(row['事件编号']) !== primaryEventId)
              .map((row) => {
                const eventId = String(row['事件编号'])
                return (
                  <label key={eventId} className="check-item">
                    <input
                      type="checkbox"
                      checked={alternateEventIds.includes(eventId)}
                      onChange={(event) => {
                        setAlternateEventIds((prev) =>
                          event.target.checked ? [...prev, eventId] : prev.filter((id) => id !== eventId),
                        )
                        resetPreview()
                      }}
                    />
                    {eventId} {String(row['事件名称'])}
                    {String(row.status) === '已发布' ? '' : `（${String(row.status)}）`}
                  </label>
                )
              })}
          </div>
        </div>
      </div>

      <div className="panel-actions">
        <button className="btn" type="button" onClick={preview}>
          预览步骤序列
        </button>
        <button className="btn primary" type="button" onClick={confirm} disabled={!plan}>
          确认回写
        </button>
        <button className="btn" type="button" onClick={publish} disabled={!publishGated}>
          发布转化清单
        </button>
        <span className="panel-note">
          已发布可回填事件：{publishedEvents.map((row) => String(row['事件编号'])).join('、') || '无'}
        </span>
      </div>

      {plan && (
        <div className="panel-body" data-testid="coverage-preview">
          <table className="data-table">
            <thead>
              <tr>
                <th>步骤</th>
                <th>主事件</th>
                <th>备选事件</th>
                <th>覆盖状态</th>
                <th>预计步骤转化率</th>
                <th>累计转化率</th>
                <th>缺失提示</th>
              </tr>
            </thead>
            <tbody>
              {plan.steps.map((step) => (
                <tr key={step.index} className={step.index === stepIndex ? 'row-selected' : undefined}>
                  <td>
                    第{step.index}步 {step.name}
                  </td>
                  <td>
                    {step.primary ? (
                      <>
                        {step.primary.eventId} {step.primary.eventName}
                        <small className="cell-sub">
                          {step.primary.version} · 采样 {step.primary.samplingLabel} · {step.primary.product}
                        </small>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>{step.alternates.map((item) => item.eventId).join('、') || '—'}</td>
                  <td>
                    {step.coverage === 'covered' ? '已覆盖' : step.coverage === 'stale' ? '待重算' : '缺失'}
                  </td>
                  <td>{step.coverage === 'missing' ? '待回填' : formatPercent(step.estimatedStepRate)}</td>
                  <td>{formatPercent(step.cumulativeRate)}</td>
                  <td>
                    {step.missingHints.length === 0
                      ? step.note
                      : step.missingHints
                          .map((hint) => `${hint.eventId}(${hint.status})：${hint.reason}`)
                          .join('；')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <dl className="preview-facts">
            <div>
              <dt>来源事件版本</dt>
              <dd data-testid="preview-sources">
                {plan.sourceEventVersions.length === 0
                  ? '空'
                  : plan.sourceEventVersions
                      .map((item) => `${item.eventId}@${item.version}（${item.samplingLabel} · ${item.product}）`)
                      .join(' / ')}
              </dd>
            </div>
            <div>
              <dt>缺失步骤</dt>
              <dd data-testid="preview-missing-steps">
                {plan.missingSteps.length === 0 ? '空' : plan.missingSteps.join('、')}
              </dd>
            </div>
            <div>
              <dt>缺失事件</dt>
              <dd>
                {plan.missingEvents.length === 0
                  ? '无'
                  : plan.missingEvents.map((hint) => `${hint.eventId} ${hint.eventName}`).join('、')}
              </dd>
            </div>
            <div>
              <dt>预计整体转化率</dt>
              <dd>{formatPercent(plan.estimatedOverallRate)}</dd>
            </div>
            <div>
              <dt>覆盖版本</dt>
              <dd>{plan.coverageVersionLabel}</dd>
            </div>
          </dl>

          {plan.confirmBlockingReasons.length > 0 && (
            <p className="error-text">回写受限：{plan.confirmBlockingReasons.join('；')}</p>
          )}
          {plan.publishBlockingReasons.length > 0 && (
            <p className="warn-text">发布受限：{plan.publishBlockingReasons.join('；')}</p>
          )}
        </div>
      )}

      {history.length > 0 && (
        <div className="panel-body">
          <h4 className="panel-subtitle">覆盖版本（事件改版后旧结果保留）</h4>
          <table className="data-table">
            <thead>
              <tr>
                <th>版本</th>
                <th>确认时间</th>
                <th>确认人</th>
                <th>来源事件版本</th>
                <th>步骤转化率</th>
                <th>缺失步骤</th>
              </tr>
            </thead>
            <tbody>
              {history.map((version) => (
                <tr key={version.version}>
                  <td>{version.label}</td>
                  <td>{version.createdAt}</td>
                  <td>{version.operator}</td>
                  <td>
                    {version.sourceEventVersions
                      .map((item) => `${item.eventId}@${item.version}`)
                      .join(' / ') || '—'}
                  </td>
                  <td>
                    {version.steps
                      .map(
                        (step) =>
                          `第${step.index}步 ${
                            step.coverage === 'missing' ? '待回填' : formatPercent(step.estimatedStepRate)
                          }`,
                      )
                      .join(' / ')}
                  </td>
                  <td>{version.missingSteps.length === 0 ? '空' : version.missingSteps.join('、')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <footer className="panel-foot">
        {message && <span className="notice-text">{message}</span>}
        {errorMessage && <span className="error-text">{errorMessage}</span>}
      </footer>
    </article>
  )
}
