import SettingsForm from '../components/SettingsForm'

export default function RateLimit() {
  return (
    <SettingsForm
      category="rate_limit"
      title="限速策略"
      description="配置上传/下载速率限制和滑动窗口流量控制"
      fields={[
        { key: 'enabled', label: '启用限速', type: 'toggle', help: '开启后自动根据规则调整上传和下载速度' },
        { key: 'seed_only_upload_kbps', label: '仅做种上传限速', type: 'number', unit: 'KB/s', help: '无活动下载时的上传速度上限（0 表示不限制）', min: 0 },
        { key: 'active_dl_upload_kbps', label: '下载时上传限速', type: 'number', unit: 'KB/s', help: '有活动下载任务时的上传速度上限', min: 0 },
        { key: 'active_dl_download_kbps', label: '下载限速', type: 'number', unit: 'KB/s', help: '下载速度上限（0 表示不限制）', min: 0 },
        { key: 'sliding_window_enabled', label: '启用滑动窗口', type: 'toggle', help: '开启后按时间窗口统计并限制总流量' },
        { key: 'hourly_limit_gb', label: '每小时上限', type: 'number', unit: 'GB', help: '每小时最大上传量，超出后自动限速', min: 1 },
        { key: 'daily_limit_gb', label: '每日上限', type: 'number', unit: 'GB', help: '每 24 小时最大上传量，超出后自动限速', min: 1 },
      ]}
    />
  )
}
