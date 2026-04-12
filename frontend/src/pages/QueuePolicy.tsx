import SettingsForm from '../components/SettingsForm'

export default function QueuePolicy() {
  return (
    <SettingsForm
      category="queue"
      title="队列策略"
      description="配置智能队列管理规则 — 根据下载者数量自动暂停/恢复种子"
      fields={[
        { key: 'enabled', label: '启用队列管理', type: 'toggle', help: '开启后根据下载者数量智能调整种子状态' },
        { key: 'pause_when_no_leechers', label: '无下载者时暂停', type: 'toggle', help: '当种子没有下载者时自动暂停，节省带宽和系统资源' },
        { key: 'resume_when_leechers_gt', label: '恢复阈值', type: 'number', unit: '人', help: '当下载者数量超过此值时自动恢复做种', min: 0 },
        { key: 'min_seed_time_hours', label: '最小做种时间', type: 'number', unit: '小时', help: '种子添加后至少做种此时长才参与队列调度', min: 0, max: 48 },
      ]}
    />
  )
}
