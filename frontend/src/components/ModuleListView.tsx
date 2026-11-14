import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import { downloadEntries, listEntries, moduleMeta, runAction } from '@/api/local-service'
import type { EntryRow } from '@/data/types'

type RenderExtra = (context: { reload: () => void; rows: EntryRow[] }) => ReactNode

export type ModuleListViewProps = {
  moduleKey: string
  /** 模块页附加的联动面板，渲染在筛选条与清单之间。 */
  renderExtra?: RenderExtra
  /** 在标准行动作后追加自定义操作，可用 reload 让清单立刻反映落库结果。 */
  renderRowExtra?: (row: EntryRow, context: { reload: () => void }) => ReactNode
}

// 18 个业务模块页共用这一份清单实现：字段、状态、动作全部取自模块元数据，页面不再各写一遍。
export default function ModuleListView({ moduleKey, renderExtra, renderRowExtra }: ModuleListViewProps) {
  const meta = useMemo(() => moduleMeta(moduleKey), [moduleKey])
  const [rows, setRows] = useState<EntryRow[]>([])
  const [total, setTotal] = useState(0)
  const [errorMessage, setErrorMessage] = useState('')
  const [notice, setNotice] = useState('')
  const [filters, setFilters] = useState<Record<string, string>>({})
  const filterFields = useMemo(() => meta.fields.slice(0, 3), [meta])

  const reload = useCallback(() => {
    setErrorMessage('')
    try {
      const payload = listEntries(meta.key, filters)
      setRows(payload.items)
      setTotal(payload.total)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : `${meta.name}列表读取失败`)
    }
  }, [meta, filters])

  useEffect(() => {
    reload()
  }, [reload])

  function run(action: string, row: EntryRow) {
    setErrorMessage('')
    setNotice('')
    const result = runAction(meta.key, Number(row.id), action)
    if (!result.ok) {
      setErrorMessage(result.message)
      return
    }
    setNotice(result.message)
    reload()
  }

  const pendingCount = rows.filter((row) => row.pending).length
  const abnormalCount = rows.filter((row) => row.abnormal).length

  return (
    <section className="page" data-module={meta.key}>
      <header className="page-head">
        <div>
          <h2>{meta.name}</h2>
          <p className="page-desc">{meta.desc}</p>
        </div>
        <div className="page-actions">
          <button
            className="btn primary"
            type="button"
            onClick={() => setErrorMessage(`${meta.entity}登记入口尚未接入审批流`)}
          >
            登记{meta.entity}
          </button>
          <button className="btn" type="button" onClick={() => downloadEntries(meta.key)}>
            导出{meta.name}清单
          </button>
        </div>
      </header>

      <div className="stat-row">
        <article className="stat-card">
          <span className="stat-label">{meta.name}记录总数</span>
          <strong className="stat-value">{total}</strong>
        </article>
        <article className="stat-card">
          <span className="stat-label">待处理</span>
          <strong className="stat-value">{pendingCount}</strong>
        </article>
        <article className="stat-card">
          <span className="stat-label">异常量</span>
          <strong className="stat-value">{abnormalCount}</strong>
        </article>
      </div>

      <p className="status-legend">
        {meta.statuses.map((status) => (
          <span key={status} className="legend-item">
            {status}：{rows.filter((row) => String(row.status) === status).length}
          </span>
        ))}
      </p>

      <form className="filter-bar" onSubmit={(event) => { event.preventDefault(); reload() }}>
        {filterFields.map((field) => (
          <label key={field} className="filter-item">
            <span>{field}</span>
            <input
              value={filters[field] ?? ''}
              placeholder={`按${field}检索`}
              onChange={(event) => setFilters((prev) => ({ ...prev, [field]: event.target.value }))}
            />
          </label>
        ))}
        <button className="btn" type="submit">查询</button>
        <button className="btn ghost" type="button" onClick={() => setFilters({})}>重置条件</button>
      </form>

      {renderExtra?.({ reload, rows })}

      <table className="data-table">
        <thead>
          <tr>
            {meta.fields.map((field) => <th key={field}>{field}</th>)}
            <th>当前状态</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={String(row.id)}>
              {meta.fields.map((field) => <td key={field}>{row[field] ?? '—'}</td>)}
              <td>{row.status}</td>
              <td className="row-actions">
                {meta.actions.map((action) => (
                  <button key={action} className="link" type="button" onClick={() => run(action, row)}>
                    {action}
                  </button>
                ))}
                {renderRowExtra?.(row, { reload })}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td className="empty-state" colSpan={meta.fields.length + 2}>
                暂无{meta.name}数据，可先登记{meta.entity}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <footer className="page-foot">
        <span>共 {total} 条{meta.name}记录</span>
        <span>
          {notice && <span className="notice-text">{notice}</span>}
          {errorMessage && <span className="error-text">{errorMessage}</span>}
        </span>
      </footer>
    </section>
  )
}
