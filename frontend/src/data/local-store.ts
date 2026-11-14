import { SEED_CONVERSION_COVERAGE } from './seed-coverage'
import { SEED_ROWS } from './seed'
import type { ConversionCoverageState } from './conversion-coverage'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
// 清单数据和转化覆盖状态存在同一份文档里，回写与状态更新才能一次写完、一起成功或一起失败。
const STORAGE_KEY = 'data-product-ops:entries'
const SCHEMA_VERSION = 2

type StoreDoc = {
  version: number
  entries: Record<string, EntryRow[]>
  coverage: Record<string, ConversionCoverageState>
}

export type StoreSnapshot = {
  entries: Record<string, EntryRow[]>
  coverage: Record<string, ConversionCoverageState>
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function seedDoc(): StoreDoc {
  return {
    version: SCHEMA_VERSION,
    entries: clone(SEED_ROWS),
    coverage: clone(SEED_CONVERSION_COVERAGE),
  }
}

function isStoreDoc(value: unknown): value is StoreDoc {
  if (!value || typeof value !== 'object') {
    return false
  }
  const candidate = value as Partial<StoreDoc>
  return (
    candidate.version === SCHEMA_VERSION &&
    !!candidate.entries &&
    typeof candidate.entries === 'object' &&
    !!candidate.coverage &&
    typeof candidate.coverage === 'object'
  )
}

function readStorage(): StoreDoc {
  const fallback = seedDoc()
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    writeDoc(fallback)
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as unknown
    if (isStoreDoc(parsed)) {
      // 新模块或新种子行按 key 合并，已有数据优先。
      return {
        version: SCHEMA_VERSION,
        entries: { ...fallback.entries, ...parsed.entries },
        coverage: { ...fallback.coverage, ...parsed.coverage },
      }
    }
    // 兼容旧版纯清单格式：整体平移到 entries，覆盖状态用种子补上。
    // 新增字段（事件版本、步骤转化率等）只补缺不覆盖，已有登记和状态原样保留。
    const legacy = parsed as Record<string, EntryRow[]>
    const entries: Record<string, EntryRow[]> = { ...fallback.entries }
    for (const [key, legacyRows] of Object.entries(legacy)) {
      if (!Array.isArray(legacyRows)) {
        continue
      }
      const seedRows = fallback.entries[key] ?? []
      const migratedRows = legacyRows.map((row) => {
        const seedRow = seedRows.find((item) => Number(item.id) === Number(row.id))
        return seedRow ? { ...seedRow, ...row } : row
      })
      // 旧格式里没有登记过的种子行补回去，避免升级后清单莫名少记录。
      const missingSeedRows = seedRows.filter(
        (seedRow) => !legacyRows.some((row) => Number(row.id) === Number(seedRow.id)),
      )
      entries[key] = [...migratedRows, ...missingSeedRows]
    }
    const migrated: StoreDoc = {
      version: SCHEMA_VERSION,
      entries,
      coverage: fallback.coverage,
    }
    writeDoc(migrated)
    return migrated
  } catch {
    writeDoc(fallback)
    return fallback
  }
}

function writeDoc(doc: StoreDoc): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    // 单次 setItem 写入整份文档：失败时旧值保持不变。
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(doc))
  }
}

let cache: StoreDoc | null = null

function current(): StoreDoc {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function allRows(): Record<string, EntryRow[]> {
  return current().entries
}

export function listRows(key: string): EntryRow[] {
  return current().entries[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const doc = current()
  const next: StoreDoc = {
    ...doc,
    entries: { ...doc.entries, [key]: rows },
  }
  writeDoc(next)
  cache = next
}

export function coverageState(conversionCode: string): ConversionCoverageState | undefined {
  return current().coverage[conversionCode]
}

export function coverageStates(): Record<string, ConversionCoverageState> {
  return current().coverage
}

/**
 * 一次性提交多模块清单与转化覆盖状态。
 * 先把整份文档序列化好再写；写入抛错时内存缓存保持原样，不会出现「只更新了事件覆盖」的半成品。
 */
export function commitStore(snapshot: StoreSnapshot): void {
  const doc = current()
  const next: StoreDoc = {
    version: SCHEMA_VERSION,
    entries: { ...doc.entries, ...snapshot.entries },
    coverage: { ...doc.coverage, ...snapshot.coverage },
  }
  // 序列化本身也可能失败（循环引用等），放在写入前，失败则什么都不改。
  const serialized = JSON.stringify(next)
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, serialized)
  }
  cache = next
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function resetCoverage(conversionCode?: string): void {
  const doc = current()
  const nextCoverage = conversionCode
    ? { ...doc.coverage, [conversionCode]: clone(SEED_CONVERSION_COVERAGE[conversionCode]) }
    : clone(SEED_CONVERSION_COVERAGE)
  const next: StoreDoc = { ...doc, coverage: nextCoverage }
  writeDoc(next)
  cache = next
}

export function storageKey(): string {
  return STORAGE_KEY
}
