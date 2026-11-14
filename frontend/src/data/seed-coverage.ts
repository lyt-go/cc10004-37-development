import type { ConversionCoverageState } from './conversion-coverage'

// 转化覆盖状态的种子：CONV-0003 前三步只回填了前两步，第三步刻意留空，
// 用 EVEN-0003（click_submit）回填后才能发布转化清单。
export const SEED_CONVERSION_COVERAGE: Record<string, ConversionCoverageState> = {
  'CONV-0001': {
    conversionCode: 'CONV-0001',
    bindings: {},
    versions: [],
  },
  'CONV-0002': {
    conversionCode: 'CONV-0002',
    bindings: {},
    versions: [],
  },
  'CONV-0003': {
    conversionCode: 'CONV-0003',
    bindings: {
      '1': { primaryEventId: 'EVEN-0001', alternateEventIds: [] },
      '2': { primaryEventId: 'EVEN-0004', alternateEventIds: [] },
    },
    versions: [],
  },
}
