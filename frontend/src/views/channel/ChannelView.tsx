import ModuleListView from '@/components/ModuleListView'

// 渠道管理模块：清单结构统一由 ModuleListView 渲染，字段、状态和动作取自模块元数据。
export default function ChannelView() {
  return <ModuleListView moduleKey="channel" />
}
