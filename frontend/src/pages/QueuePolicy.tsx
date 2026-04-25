import SettingsForm from '../components/SettingsForm'

export default function QueuePolicy() {
  return (
    <SettingsForm
      category="queue"
      title="队列策略"
      description="配置智能队列管理规则 — 热窗口内持续做种，旧种按批次探测需求"
      fields={[
        { key: 'enabled', label: '启用队列管理', type: 'toggle', help: '开启后根据下载者数量智能调整种子状态' },
        { key: 'pause_when_no_leechers', label: '无下载者时暂停', type: 'toggle', help: '开启后超过热窗口且无下载者的种子会暂停，避免长期占队列' },
        { key: 'resume_when_leechers_gt', label: '恢复阈值', type: 'number', unit: '人', help: '当下载者数量超过此值时自动恢复做种', min: 0 },
        { key: 'min_seed_time_hours', label: '热窗口', type: 'number', unit: '小时', help: '新种在此时间内持续做种，避免错过发布初期的短暂下载者', min: 0, max: 168 },
        { key: 'exclude_tags', label: '排除标签', type: 'tags', help: '带有这些标签的种子不会被队列暂停/恢复或关键词清理，多个标签用逗号分隔' },
        { key: 'probe_stopped_enabled', label: '探测暂停旧种', type: 'toggle', help: '定时短暂恢复一批暂停种子，窗口内有人下载就保留做种，否则再次暂停' },
        { key: 'probe_interval_minutes', label: '探测间隔', type: 'number', unit: '分钟', help: '每隔多久启动一批旧种探测', min: 3, max: 240 },
        { key: 'probe_batch_size', label: '探测批量', type: 'number', unit: '个', help: '每轮最多短暂恢复多少个暂停种子', min: 1, max: 200 },
        { key: 'probe_duration_minutes', label: '探测窗口', type: 'number', unit: '分钟', help: '探测种子保持运行的时间；窗口结束仍无下载者则暂停', min: 3, max: 60 },
        { key: 'keyword_cleanup_enabled', label: '启用关键词清理', type: 'toggle', help: '开启后会清理名称命中关键词且已完成做种超过指定时间的种子' },
        { key: 'keyword_cleanup_hours', label: '关键词清理做种时间', type: 'number', unit: '小时', help: '种子完成下载并做种达到此时长后，若名称包含下方关键词则删除种子和文件', min: 0, max: 720 },
        { key: 'keyword_cleanup_keywords', label: '清理关键词', type: 'tags', help: '多个关键词用逗号分隔，例如：Dynamis One。匹配不区分大小写' },
        { key: 'keyword_cleanup_max_per_run', label: '每轮最多清理', type: 'number', unit: '个', help: '每次队列巡检最多删除的关键词命中种子数量，防止误配置造成大量删除', min: 1, max: 100 },
      ]}
    />
  )
}
