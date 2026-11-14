import type { EntryRow } from './types'

// 转化步骤回写的唯一一份共用实现：预览、主/备事件裁决、覆盖缺口语义和覆盖版本都在这里产出，
// 页面只负责渲染，本地服务只负责持久化，不在别处再算一遍。

const STEP_SEPARATOR = /\s*(?:>|→|;|；|\n)\s*/

export type StepCoverage = 'covered' | 'missing' | 'stale'

export type StepDefinition = {
  index: number
  name: string
}

export type StepBinding = {
  /** 明确指定的主事件；只有它计入覆盖与步骤转化率。 */
  primaryEventId: string
  /** 同一步骤的其他事件，只作展示和缺失提示，不重复计入。 */
  alternateEventIds: string[]
}

export type StepBindings = Record<string, StepBinding>

export type EventSnapshot = {
  eventId: string
  eventName: string
  eventType: string
  status: string
  samplingPercent: number
  samplingLabel: string
  product: string
  version: string
  published: boolean
  signature: string
}

export type SourceEventVersion = {
  eventId: string
  eventName: string
  version: string
  samplingLabel: string
  product: string
  signature: string
}

export type EventHint = {
  eventId: string
  eventName: string
  status: string
  reason: string
}

export type PreviewStep = {
  index: number
  name: string
  primary: EventSnapshot | null
  alternates: EventSnapshot[]
  coverage: StepCoverage
  estimatedStepRate: number
  cumulativeRate: number
  missingHints: EventHint[]
  note: string
}

export type CoveragePlan = {
  conversionCode: string
  conversionName: string
  steps: PreviewStep[]
  sourceEventVersions: SourceEventVersion[]
  missingSteps: string[]
  missingEvents: EventHint[]
  estimatedOverallRate: number
  coverageVersionLabel: string
  coverageConfirmed: boolean
  sourcesReady: boolean
  missingStepsClear: boolean
  staleSteps: number
  canConfirm: boolean
  canPublish: boolean
  confirmBlockingReasons: string[]
  publishBlockingReasons: string[]
}

export type CoverageStepSnapshot = {
  index: number
  name: string
  primaryEventId: string
  primaryEventName: string
  primaryEventVersion: string
  alternateEventIds: string[]
  estimatedStepRate: number
  cumulativeRate: number
  coverage: StepCoverage
}

export type CoverageVersion = {
  version: number
  label: string
  createdAt: string
  operator: string
  status: '已确认' | '已启用'
  sourceEventVersions: SourceEventVersion[]
  steps: CoverageStepSnapshot[]
  missingSteps: string[]
  estimatedOverallRate: number
}

export type ConversionCoverageState = {
  conversionCode: string
  bindings: StepBindings
  versions: CoverageVersion[]
}

export type DraftBinding = {
  stepIndex: number
  primaryEventId: string
  alternateEventIds?: string[]
}

export type BuildCoveragePlanOptions = {
  conversion: EntryRow
  events: EntryRow[]
  bindings: StepBindings
  latestVersion?: CoverageVersion | null
  draft?: DraftBinding | null
}

export function round1(value: number): number {
  return Math.round(value * 10) / 10
}

export function formatPercent(value: number): string {
  return `${round1(value)}%`
}

export function parseSteps(row: EntryRow): StepDefinition[] {
  const raw = String(row['步骤序列'] ?? '').trim()
  if (!raw || raw === '—') {
    return []
  }
  const parts = raw.split(STEP_SEPARATOR).map((part) => part.trim()).filter(Boolean)
  if (parts.length === 0) {
    return []
  }
  if (parts.length === 1) {
    const single = parts[0].match(/^(\d+)\s*[:：]\s*(.+)$/)
    return single
      ? [{ index: Number(single[1]), name: single[2].trim() }]
      : [{ index: 1, name: parts[0] }]
  }
  return parts.map((part, position) => {
    const matched = part.match(/^(\d+)\s*[:：]\s*(.+)$/)
    return matched
      ? { index: Number(matched[1]), name: matched[2].trim() }
      : { index: position + 1, name: part }
  })
}

export function parseSamplingPercent(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.min(100, round1(value)))
  }
  const text = String(value ?? '').trim()
  if (!text) {
    return 0
  }
  const matched = text.match(/-?\d+(?:\.\d+)?/)
  if (!matched) {
    return 0
  }
  let parsed = Number(matched[0])
  if (!text.includes('%') && parsed > 0 && parsed <= 1) {
    parsed *= 100
  }
  return Math.max(0, Math.min(100, round1(parsed)))
}

export function eventSignature(row: EntryRow): string {
  return [
    row['事件编号'],
    row['事件名称'],
    row['事件类型'],
    row['触发条件'],
    row['上报参数'],
    row['采样比例'],
    row['所属产品'],
    row['事件版本'],
  ]
    .map((value) => String(value ?? ''))
    .join('|')
}

export function eventSnapshot(row: EntryRow): EventSnapshot {
  const status = String(row.status ?? '')
  return {
    eventId: String(row['事件编号'] ?? row.id),
    eventName: String(row['事件名称'] ?? ''),
    eventType: String(row['事件类型'] ?? ''),
    status,
    samplingPercent: parseSamplingPercent(row['采样比例']),
    samplingLabel: String(row['采样比例'] ?? '—'),
    product: String(row['所属产品'] ?? '—'),
    version: String(row['事件版本'] ?? 'v1.0'),
    published: status === '已发布',
    signature: eventSignature(row),
  }
}

export function eventMap(events: EntryRow[]): Map<string, EventSnapshot> {
  const map = new Map<string, EventSnapshot>()
  for (const event of events) {
    const snapshot = eventSnapshot(event)
    map.set(snapshot.eventId, snapshot)
  }
  return map
}

export function applyDraftBinding(bindings: StepBindings, draft: DraftBinding | null | undefined): StepBindings {
  const next: StepBindings = {}
  for (const [key, value] of Object.entries(bindings)) {
    next[key] = {
      primaryEventId: value.primaryEventId,
      alternateEventIds: [...value.alternateEventIds],
    }
  }
  if (!draft) {
    return next
  }
  const stepKey = String(draft.stepIndex)
  const existing = next[stepKey]
  next[stepKey] = {
    primaryEventId: draft.primaryEventId,
    alternateEventIds: [
      ...(draft.alternateEventIds ?? existing?.alternateEventIds ?? []),
    ].filter((eventId, position, list) => eventId !== draft.primaryEventId && list.indexOf(eventId) === position),
  }
  return next
}

function coverageVersionForStep(latestVersion: CoverageVersion | null | undefined, stepIndex: number): CoverageStepSnapshot | undefined {
  return latestVersion?.steps.find((step) => step.index === stepIndex)
}

// 步骤转化率的统一估算口径：已发布事件的采样比例就是这一步的可观测比例，未覆盖步骤计 0%。
// 每一步独立取采样比例，不额外叠加衰减系数，避免事件改版后基线漂移。
function estimatedStepRateFor(event: EventSnapshot): number {
  return round1(event.samplingPercent)
}

export function buildCoveragePlan(options: BuildCoveragePlanOptions): CoveragePlan {
  const { conversion, events, bindings, latestVersion, draft } = options
  const resolvedBindings = applyDraftBinding(bindings, draft)
  const steps = parseSteps(conversion)
  const lookup = eventMap(events)
  const previewSteps: PreviewStep[] = []
  const missingSteps: string[] = []
  const missingEvents: EventHint[] = []
  const sourceVersions = new Map<string, SourceEventVersion>()
  const missingEventVersions: SourceEventVersion[] = []
  let cumulativeRate = 100

  for (const step of steps) {
    const binding = resolvedBindings[String(step.index)] ?? { primaryEventId: '', alternateEventIds: [] }
    const primary = binding.primaryEventId ? lookup.get(binding.primaryEventId) ?? null : null
    const alternates = binding.alternateEventIds
      .filter((eventId) => eventId !== binding.primaryEventId)
      .map((eventId) => lookup.get(eventId))
      .filter((event): event is EventSnapshot => Boolean(event))
    const hints: EventHint[] = []
    let coverage: StepCoverage = 'covered'
    let note = ''

    if (!primary) {
      coverage = 'missing'
      note = binding.primaryEventId
        ? `主事件 ${binding.primaryEventId} 不存在，需重新指定`
        : '未指定主事件，步骤缺失'
    } else if (!primary.published) {
      coverage = 'missing'
      note = `主事件 ${primary.eventId} 当前为「${primary.status}」，未发布事件不能计入覆盖`
      hints.push({
        eventId: primary.eventId,
        eventName: primary.eventName,
        status: primary.status,
        reason: '主事件未发布，只能作为缺失项提示',
      })
    } else {
      const previous = coverageVersionForStep(latestVersion, step.index)
      if (previous && previous.primaryEventId === primary.eventId && previous.primaryEventVersion !== primary.version) {
        coverage = 'stale'
        note = `事件已改版至 ${primary.version}，覆盖版本 ${latestVersion?.label ?? ''} 的旧结果已保留，需重新回写`
      } else {
        note = `主事件 ${primary.eventId} 唯一计入覆盖`
      }
    }

    for (const alternate of alternates) {
      if (!alternate.published) {
        hints.push({
          eventId: alternate.eventId,
          eventName: alternate.eventName,
          status: alternate.status,
          reason: '备选事件未发布，只能作为缺失项提示，不计入覆盖与转化率',
        })
      }
    }
    if (alternates.length > 0) {
      note = `${note}；备选 ${alternates.length} 个，不重复计入`
    }

    const estimatedStepRate = coverage !== 'missing' && primary ? estimatedStepRateFor(primary) : 0
    cumulativeRate = round1((cumulativeRate * estimatedStepRate) / 100)

    if (coverage === 'missing') {
      missingSteps.push(step.name)
    }
    if (hints.length > 0) {
      missingEvents.push(...hints)
    }
    if (primary) {
      // 未发布事件只作为缺失项，不能出现在来源事件版本里（否则发布校验会被它蒙混过关）。
      const sourceVersion: SourceEventVersion = {
        eventId: primary.eventId,
        eventName: primary.eventName,
        version: primary.version,
        samplingLabel: primary.samplingLabel,
        product: primary.product,
        signature: primary.signature,
      }
      if (primary.published) {
        sourceVersions.set(primary.eventId, sourceVersion)
      } else {
        missingEventVersions.push(sourceVersion)
      }
    }

    previewSteps.push({
      index: step.index,
      name: step.name,
      primary,
      alternates,
      coverage,
      estimatedStepRate,
      cumulativeRate,
      missingHints: hints,
      note,
    })
  }

  const sourceEventVersions = [...sourceVersions.values()]
  const targetDraftStep = draft ? previewSteps.find((step) => step.index === draft.stepIndex) : undefined
  const confirmBlockingReasons: string[] = []
  if (draft) {
    if (!targetDraftStep) {
      confirmBlockingReasons.push(`没有找到第 ${draft.stepIndex} 步`)
    } else if (!targetDraftStep.primary) {
      confirmBlockingReasons.push('请选择已发布的埋点事件作为主事件')
    } else if (!targetDraftStep.primary.published) {
      confirmBlockingReasons.push(`事件 ${targetDraftStep.primary.eventId} 未发布，不能作为主事件回写`)
    }
  } else if (steps.length === 0) {
    confirmBlockingReasons.push('转化定义没有可回写的步骤序列')
  }

  const coverageConfirmed = Boolean(latestVersion)
  const sourcesReady = sourceEventVersions.length > 0
  const missingStepsClear = missingSteps.length === 0
  const staleSteps = previewSteps.filter((step) => step.coverage === 'stale').length

  // 没有草稿时用于「事件改版后整份重算」：要求所有步骤都已覆盖，不能借重算绕过缺失步骤。
  if (!draft && missingSteps.length > 0) {
    confirmBlockingReasons.push(`存在缺失步骤：${missingSteps.join('、')}，需先指定主事件`)
  }
  if (missingEventVersions.length > 0) {
    confirmBlockingReasons.push(
      `未发布事件不能计入覆盖：${missingEventVersions.map((item) => item.eventId).join('、')}`,
    )
  }

  const publishBlockingReasons: string[] = []
  if (!coverageConfirmed) {
    publishBlockingReasons.push('尚未确认事件回写，转化清单不能发布')
  }
  if (!missingStepsClear) {
    publishBlockingReasons.push(`存在缺失步骤：${missingSteps.join('、')}`)
  }
  if (!sourcesReady) {
    publishBlockingReasons.push('来源事件版本为空，不能发布转化清单')
  }
  if (staleSteps > 0) {
    publishBlockingReasons.push(`有 ${staleSteps} 步的来源事件已改版，需按新事件版本重新回写`)
  }
  return {
    conversionCode: String(conversion['转化编号'] ?? conversion.id),
    conversionName: String(conversion['转化名称'] ?? ''),
    steps: previewSteps,
    sourceEventVersions,
    missingSteps,
    missingEvents,
    estimatedOverallRate: previewSteps.length > 0 ? previewSteps[previewSteps.length - 1].cumulativeRate : 0,
    coverageVersionLabel: latestVersion?.label ?? '—',
    coverageConfirmed,
    sourcesReady,
    missingStepsClear,
    staleSteps,
    canConfirm: steps.length > 0 && confirmBlockingReasons.length === 0,
    canPublish: publishBlockingReasons.length === 0,
    confirmBlockingReasons,
    publishBlockingReasons,
  }
}

export function createCoverageVersion(
  plan: CoveragePlan,
  versionNumber: number,
  operator: string,
  createdAt: string,
): CoverageVersion {
  return {
    version: versionNumber,
    label: `v${versionNumber}`,
    createdAt,
    operator,
    status: '已确认',
    sourceEventVersions: plan.sourceEventVersions.map((item) => ({ ...item })),
    steps: plan.steps.map((step) => ({
      index: step.index,
      name: step.name,
      primaryEventId: step.primary?.eventId ?? '',
      primaryEventName: step.primary?.eventName ?? '',
      primaryEventVersion: step.primary?.version ?? '',
      alternateEventIds: step.alternates.map((item) => item.eventId),
      estimatedStepRate: step.estimatedStepRate,
      cumulativeRate: step.cumulativeRate,
      coverage: step.coverage,
    })),
    missingSteps: [...plan.missingSteps],
    estimatedOverallRate: plan.estimatedOverallRate,
  }
}

export function summarizeStepRates(plan: CoveragePlan): string {
  return plan.steps
    .map((step) => {
      if (step.coverage === 'missing') {
        return `第${step.index}步 待回填`
      }
      const rate = formatPercent(step.estimatedStepRate)
      return step.coverage === 'stale'
        ? `第${step.index}步 ${rate}（事件已改版，待重算）`
        : `第${step.index}步 ${rate}`
    })
    .join(' / ')
}

export function summarizeCoverage(plan: CoveragePlan): string {
  const covered = plan.steps.filter((step) => step.coverage !== 'missing').length
  const stale = plan.steps.filter((step) => step.coverage === 'stale').length
  return stale > 0
    ? `${covered}/${plan.steps.length} 已覆盖（${stale} 步事件已改版）`
    : `${covered}/${plan.steps.length} 已覆盖`
}

export function summarizeSources(plan: CoveragePlan): string {
  if (plan.sourceEventVersions.length === 0) {
    return '—'
  }
  return plan.sourceEventVersions.map((item) => `${item.eventId}@${item.version}`).join(' / ')
}

export function applyCoverageToRow(
  row: EntryRow,
  plan: CoveragePlan,
  version: CoverageVersion,
  targetStatus: string,
): EntryRow {
  return {
    ...row,
    status: targetStatus,
    pending: true,
    abnormal: false,
    '步骤序列': plan.steps.map((step) => `${step.index}:${step.name}`).join(' > '),
    '每步事件': plan.steps.map((step) => step.primary?.eventName ?? '待回填').join(' > '),
    '步骤转化率': summarizeStepRates(plan),
    '事件覆盖': summarizeCoverage(plan),
    '来源事件版本': summarizeSources(plan),
    '覆盖版本': version.label,
    '缺失步骤': plan.missingSteps.join('、'),
  }
}
