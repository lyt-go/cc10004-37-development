import { MODULE_BY_KEY } from '@/data/modules'
import {
  applyCoverageToRow,
  buildCoveragePlan,
  createCoverageVersion,
} from '@/data/conversion-coverage'
import type {
  CoveragePlan,
  CoverageVersion,
  ConversionCoverageState,
  DraftBinding,
} from '@/data/conversion-coverage'
import {
  allRows,
  commitStore,
  coverageState,
  listRows,
  resetCoverage,
  resetRows,
  saveRows,
} from '@/data/local-store'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 事件登记清单里统一使用的默认值，避免事件改版时覆盖版本跟着漂移。
export const DEFAULT_EVENT_VERSION = 'v1.0'
export const DEFAULT_OPERATOR = '值班管理员'

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  // 转化清单发布带覆盖校验，不允许绕过回写直接改状态。
  if (key === 'conversion' && action === '发布转化清单') {
    return publishConversionList(String(rows[index]['转化编号'] ?? id))
  }
  return applyTransition(key, meta, rows, index, action, target)
}

// 所有状态流转都走这里：普通动作、事件发布回写、转化清单发布共用一套校验与提交。
// allowSameStatus 用于「只回写覆盖、暂不换状态」的内部写入，其余动作仍然拒绝原地重复。
function applyTransition(
  key: string,
  meta: ModuleMeta,
  rows: EntryRow[],
  index: number,
  action: string,
  target: string,
  extra?: {
    entries?: Record<string, EntryRow[]>
    coverage?: Record<string, ConversionCoverageState>
    row?: EntryRow
    allowSameStatus?: boolean
  },
): ActionResult {
  const current = String(rows[index].status)
  if (current === target && !extra?.allowSameStatus) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...(extra?.row ?? rows[index]),
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  try {
    commitStore({ entries: { [key]: next, ...(extra?.entries ?? {}) }, coverage: extra?.coverage ?? {} })
  } catch (error) {
    return {
      ok: false,
      message: `${meta.entity}「${action}」失败，数据未写入：${error instanceof Error ? error.message : '未知错误'}`,
    }
  }
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  if (key === 'conversion') {
    resetCoverage()
  }
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}

// ---- 事件回写转化步骤 ----------------------------------------------------

function conversionRow(idOrCode: number | string): EntryRow | undefined {
  return listRows('conversion').find(
    (row) => String(row.id) === String(idOrCode) || String(row['转化编号'] ?? '') === String(idOrCode),
  )
}

function latestVersionOf(state: ConversionCoverageState | undefined): CoverageVersion | null {
  if (!state || state.versions.length === 0) {
    return null
  }
  return state.versions[state.versions.length - 1]
}

function emptyCoverageState(conversionCode: string): ConversionCoverageState {
  return { conversionCode, bindings: {}, versions: [] }
}

export function coverageOf(conversionCode: string): ConversionCoverageState {
  return coverageState(conversionCode) ?? emptyCoverageState(conversionCode)
}

/** 预览步骤序列、缺失事件、预计步骤转化率；只读，不写任何数据。 */
export function previewConversionCoverage(
  conversionIdOrCode: number | string,
  draft: DraftBinding | null = null,
): ActionResult & { plan: CoveragePlan | null } {
  const conversion = conversionRow(conversionIdOrCode)
  if (!conversion) {
    return { ok: false, message: `没有找到转化定义 ${conversionIdOrCode}`, plan: null }
  }
  const conversionCode = String(conversion['转化编号'] ?? conversion.id)
  const state = coverageOf(conversionCode)
  const plan = buildCoveragePlan({
    conversion,
    events: listRows('eventdef'),
    bindings: state.bindings,
    latestVersion: latestVersionOf(state),
    draft,
  })
  return { ok: true, message: '已生成回写预览，确认前不会修改转化清单', plan }
}

/** 确认回写：覆盖版本、覆盖状态与转化清单状态在同一次提交里写入，要么都成功要么都不变。 */
export function confirmConversionCoverage(
  conversionIdOrCode: number | string,
  draft: DraftBinding,
  operator = DEFAULT_OPERATOR,
): ActionResult & { plan: CoveragePlan | null; version: CoverageVersion | null } {
  const conversion = conversionRow(conversionIdOrCode)
  if (!conversion) {
    return { ok: false, message: `没有找到转化定义 ${conversionIdOrCode}`, plan: null, version: null }
  }
  const conversionCode = String(conversion['转化编号'] ?? conversion.id)
  const state = coverageOf(conversionCode)
  // 预览在确认时重新算一次，保证看到的是落库前的最新覆盖情况。
  const plan = buildCoveragePlan({
    conversion,
    events: listRows('eventdef'),
    bindings: state.bindings,
    latestVersion: latestVersionOf(state),
    draft,
  })
  if (!plan.canConfirm) {
    return {
      ok: false,
      message: plan.confirmBlockingReasons.join('；') || '回写条件不满足，转化清单未修改',
      plan,
      version: null,
    }
  }

  const numbers = state.versions.map((item) => item.version)
  const versionNumber = numbers.length === 0 ? 1 : Math.max(...numbers) + 1
  const createdAt = new Date().toISOString().slice(0, 19).replace('T', ' ')
  // 事件改版后签名会变，同一主事件也能形成新的覆盖版本；旧版本原样保留在 versions 里。
  const version = createCoverageVersion(plan, versionNumber, operator, createdAt)
  const nextState: ConversionCoverageState = {
    conversionCode,
    // 主事件继续沿用，备选事件保留在记录里但不重复计入。
    bindings: plan.steps.reduce<Record<string, { primaryEventId: string; alternateEventIds: string[] }>>(
      (accumulator, step) => {
        if (step.primary) {
          accumulator[String(step.index)] = {
            primaryEventId: step.primary.eventId,
            alternateEventIds: step.alternates.map((item) => item.eventId),
          }
        }
        return accumulator
      },
      {},
    ),
    versions: [...state.versions, version],
  }

  const conversionModule = moduleMeta('conversion')
  const rows = listRows('conversion')
  const index = rows.findIndex((row) => Number(row.id) === Number(conversion.id))
  const updated = applyCoverageToRow(rows[index], plan, version, String(rows[index].status))
  const result = applyTransition('conversion', conversionModule, rows, index, '确认事件回写', String(rows[index].status), {
    row: updated,
    coverage: { [conversionCode]: nextState },
    entries: { eventdef: archiveCoverageOnEvents(listRows('eventdef'), plan, version) },
    allowSameStatus: true,
  })
  if (!result.ok) {
    return { ...result, plan: null, version: null }
  }
  return {
    ok: true,
    message: `已用 ${plan.sourceEventVersions.map((item) => `${item.eventId}@${item.version}`).join('、')} 回写 ${conversionCode}，覆盖版本 ${version.label}，预计整体转化率 ${plan.estimatedOverallRate}%`,
    plan,
    version,
  }
}

// 事件发布是回写的触发点：发布时把当前覆盖信息同步到事件清单，事件改版则自动形成新覆盖版本。
function archiveCoverageOnEvents(events: EntryRow[], plan: CoveragePlan, version: CoverageVersion): EntryRow[] {
  return events.map((event) => {
    const snapshot = plan.steps.find((step) => step.primary?.eventId === event['事件编号'])?.primary
    if (!snapshot) {
      return event
    }
    return {
      ...event,
      '覆盖转化': plan.conversionCode,
      '覆盖版本': version.label,
      '事件版本': snapshot.version,
    }
  })
}

/** 发布转化清单：必须已有确认过的覆盖版本，来源事件版本齐全且缺失步骤为空。 */
export function publishConversionList(conversionIdOrCode: number | string): ActionResult & { plan: CoveragePlan | null } {
  const conversion = conversionRow(conversionIdOrCode)
  if (!conversion) {
    return { ok: false, message: `没有找到转化定义 ${conversionIdOrCode}`, plan: null }
  }
  const conversionCode = String(conversion['转化编号'] ?? conversion.id)
  const state = coverageOf(conversionCode)
  const plan = buildCoveragePlan({
    conversion,
    events: listRows('eventdef'),
    bindings: state.bindings,
    latestVersion: latestVersionOf(state),
  })
  if (!plan.canPublish) {
    return {
      ok: false,
      message: `还不能发布转化清单：${plan.publishBlockingReasons.join('；')}`,
      plan,
    }
  }
  const meta = moduleMeta('conversion')
  const rows = listRows('conversion')
  const index = rows.findIndex((row) => Number(row.id) === Number(conversion.id))
  const target = meta.actionTargets['发布转化清单']
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const latest = latestVersionOf(state)
  if (!latest) {
    return { ok: false, message: `还不能发布转化清单：${plan.publishBlockingReasons.join('；')}`, plan }
  }
  const result = applyTransition('conversion', meta, rows, index, '发布转化清单', target, {
    row: applyCoverageToRow({ ...rows[index] }, plan, latest, target),
  })
  if (!result.ok) {
    return { ...result, plan: null }
  }
  return {
    ok: true,
    message: `${conversionCode} 转化清单已发布，来源事件 ${plan.sourceEventVersions.map((item) => item.eventId).join('、')}，缺失步骤为空`,
    plan,
  }
}

/** 事件在清单里改版：写入新事件版本，并保留旧的转化结果。 */
export function bumpEventVersion(id: number, nextVersion: string): ActionResult {
  const meta = moduleMeta('eventdef')
  const rows = listRows('eventdef')
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的埋点事件` }
  }
  const normalized = nextVersion.trim()
  if (!normalized) {
    return { ok: false, message: '事件版本不能为空' }
  }
  if (normalized === String(rows[index]['事件版本'] ?? DEFAULT_EVENT_VERSION)) {
    return { ok: false, message: `事件版本已经是 ${normalized}，无需改版` }
  }
  const next = [...rows]
  next[index] = { ...rows[index], '事件版本': normalized }
  try {
    commitStore({ entries: { eventdef: next }, coverage: {} })
  } catch (error) {
    return { ok: false, message: `事件改版失败，数据未写入：${error instanceof Error ? error.message : '未知错误'}` }
  }
  return {
    ok: true,
    message: `事件版本已更新为 ${normalized}；已确认的转化覆盖版本保留，重新回写会生成新覆盖版本`,
  }
}

/** 转化定义最近一次已确认的覆盖版本（旧结果），事件改版后依然可查。 */
export function conversionCoverageHistory(conversionIdOrCode: number | string): CoverageVersion[] {
  const conversion = conversionRow(conversionIdOrCode)
  if (!conversion) {
    return []
  }
  return [...coverageOf(String(conversion['转化编号'] ?? conversion.id)).versions].reverse()
}

