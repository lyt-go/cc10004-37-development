import ModuleListView from '@/components/ModuleListView'

// ROI评估模块：清单结构统一由 ModuleListView 渲染，字段、状态和动作取自模块元数据。
export default function RoiView() {
  return <ModuleListView moduleKey="roi" />
}
