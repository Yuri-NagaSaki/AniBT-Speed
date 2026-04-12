import { useQuery } from '@tanstack/react-query'
import { instancesApi, statsApi } from '../api/client'
import StatusCard from '../components/StatusCard'
import { Upload, Download, Activity, Zap, Server } from 'lucide-react'

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}

function formatSpeed(bytesPerSec: number): string {
  return `${formatBytes(bytesPerSec)}/s`
}

export default function Dashboard() {
  const { data: instances = [] } = useQuery({
    queryKey: ['instances'],
    queryFn: instancesApi.list,
  })

  const { data: summary } = useQuery({
    queryKey: ['summary'],
    queryFn: statsApi.summary,
  })

  const connectedInstances = instances.filter((i: any) => i.status?.connected)
  const totalUpSpeed = connectedInstances.reduce((sum: number, i: any) => sum + (i.status?.up_speed || 0), 0)
  const totalDlSpeed = connectedInstances.reduce((sum: number, i: any) => sum + (i.status?.dl_speed || 0), 0)
  const totalTorrents = connectedInstances.reduce((sum: number, i: any) => sum + (i.status?.total || 0), 0)
  const activeTorrents = connectedInstances.reduce((sum: number, i: any) => sum + (i.status?.active || 0), 0)

  return (
    <div className="max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
          仪表盘
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
          系统运行状态概览
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatusCard
          title="上传速度"
          value={formatSpeed(totalUpSpeed)}
          subtitle="全部实例合计"
          icon={<Upload size={16} />}
          accent="var(--success)"
        />
        <StatusCard
          title="下载速度"
          value={formatSpeed(totalDlSpeed)}
          subtitle="全部实例合计"
          icon={<Download size={16} />}
          accent="var(--accent)"
        />
        <StatusCard
          title="活跃种子"
          value={`${activeTorrents} / ${totalTorrents}`}
          subtitle="活跃 / 总计"
          icon={<Activity size={16} />}
          accent="var(--warning)"
        />
        <StatusCard
          title="实例状态"
          value={`${connectedInstances.length} / ${instances.length}`}
          subtitle="在线 / 总计"
          icon={<Server size={16} />}
          accent="var(--success)"
        />
      </div>

      {/* Today Stats */}
      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <StatusCard
            title="今日上传"
            value={formatBytes(summary.today_uploaded_bytes || 0)}
            icon={<Zap size={16} />}
            accent="#8b5cf6"
          />
          <StatusCard
            title="今日下载"
            value={formatBytes(summary.today_downloaded_bytes || 0)}
            icon={<Download size={16} />}
            accent="#06b6d4"
          />
          <StatusCard
            title="今日操作"
            value={summary.today_actions || 0}
            subtitle="自动管理操作次数"
            icon={<Activity size={16} />}
            accent="var(--warning)"
          />
        </div>
      )}

      {/* Instance List */}
      <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
        <div className="px-5 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>实例状态</h2>
        </div>
        <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
          {instances.length === 0 ? (
            <div className="px-5 py-12 text-center" style={{ color: 'var(--text-muted)' }}>
              <Server size={32} className="mx-auto mb-3 opacity-40" />
              <p className="text-sm">暂无实例，请前往「实例管理」添加</p>
            </div>
          ) : (
            instances.map((inst: any) => (
              <div key={inst.id} className="flex items-center justify-between px-5 py-3.5 transition-colors"
                style={{ borderColor: 'var(--border)' }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                <div className="flex items-center gap-3">
                  <div className="w-2.5 h-2.5 rounded-full"
                    style={{ background: inst.status?.connected ? 'var(--success)' : 'var(--danger)' }} />
                  <div>
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{inst.name}</p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{inst.url}</p>
                  </div>
                </div>
                {inst.status?.connected && (
                  <div className="flex gap-6 text-xs" style={{ color: 'var(--text-secondary)' }}>
                    <span>↑ {formatSpeed(inst.status.up_speed || 0)}</span>
                    <span>↓ {formatSpeed(inst.status.dl_speed || 0)}</span>
                    <span>{inst.status.total || 0} 种子</span>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
