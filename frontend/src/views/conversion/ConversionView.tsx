import ModuleListView from '@/components/ModuleListView'
import ConversionCoveragePanel from './ConversionCoveragePanel'

const OPERATOR = '值班管理员'

// 转化漏斗模块：清单走共用实现，事件回写与清单发布都从同一个覆盖计划推导。
export default function ConversionView() {
  return (
    <ModuleListView
      moduleKey="conversion"
      renderExtra={({ reload }) => <ConversionCoveragePanel operator={OPERATOR} reloadList={reload} />}
    />
  )
}
