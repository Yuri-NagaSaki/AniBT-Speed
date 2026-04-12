import SettingsForm from '../components/SettingsForm'

export default function SpacePolicy() {
  return (
    <SettingsForm
      category="space"
      title="空间策略"
      description="配置存储空间管理和自动删除规则"
      fields={[
        { key: 'enabled', label: '启用空间管理', type: 'toggle', help: '开启后自动管理存储空间' },
        { key: 'threshold_percent', label: '空间告警阈值', type: 'number', unit: '%', help: '存储使用超过此百分比时触发清理', min: 50, max: 99 },
        { key: 'protect_hours', label: '强制保护时间', type: 'number', unit: '小时', help: '添加后此时间内的种子不会被删除', min: 1, max: 48 },
        { key: 'boundary_hours', label: '分界时间', type: 'number', unit: '小时', help: '此时间前优先保留高分享率；此时间后优先保留低分享率', min: 1, max: 72 },
        { key: 'max_torrent_size_gb', label: '单种子最大体积', type: 'number', unit: 'GB', help: '超过此大小的种子将被拒绝（0 = 不限制）', min: 0 },
        { key: 'check_path', label: '监控目录', type: 'text', help: '用于检查磁盘使用率的目录路径' },
        { key: 'check_interval_minutes', label: '检查间隔', type: 'number', unit: '分钟', help: '空间检查的执行间隔', min: 1, max: 60 },
      ]}
    />
  )
}
