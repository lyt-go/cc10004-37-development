import { useState } from 'react'

import ModuleListView from '@/components/ModuleListView'
import { bumpEventVersion, DEFAULT_EVENT_VERSION } from '@/api/local-service'
import type { EntryRow } from '@/data/types'

// 事件定义模块：清单仍走共用实现，额外提供「事件改版」入口，改版后旧转化覆盖版本保留。
export default function EventdefView() {
  const [versionDrafts, setVersionDrafts] = useState<Record<string, string>>({})
  const [message, setMessage] = useState('')

  function bump(row: EntryRow, reload: () => void) {
    const key = String(row.id)
    const result = bumpEventVersion(Number(row.id), versionDrafts[key] ?? '')
    setMessage(result.message)
    if (result.ok) {
      setVersionDrafts((prev) => ({ ...prev, [key]: '' }))
      reload()
    }
  }

  return (
    <ModuleListView
      moduleKey="eventdef"
      renderRowExtra={(row, { reload }) => {
        const key = String(row.id)
        return (
          <span className="inline-editor" title={message}>
            <input
              className="inline-input"
              value={versionDrafts[key] ?? ''}
              placeholder={String(row['事件版本'] ?? DEFAULT_EVENT_VERSION)}
              aria-label={`事件 ${String(row['事件编号'])} 的新版本号`}
              onChange={(event) =>
                setVersionDrafts((prev) => ({ ...prev, [key]: event.target.value }))
              }
            />
            <button className="link" type="button" onClick={() => bump(row, reload)}>
              改版
            </button>
          </span>
        )
      }}
    />
  )
}
