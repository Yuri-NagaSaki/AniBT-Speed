import { useQuery } from '@tanstack/react-query'
import { instancesApi, statsApi } from '../api/client'
import StatusCard from '../components/StatusCard'
import { Upload, Download, Activity, Zap, Server, TrendingUp } from 'lucide-react'

function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}

function formatSpeed(bytesPerSec: number): string {
  return `${formatBytes(bytesPerSec)}/s`
}

function SkeletonCard() {
  return (
    <div
      className="rounded-2xl p-5 h-[120px]"
      style={{
        background: 'var(--bg-card)',
        backdropFilter: 'blur(12px)',
        border: '1px solid var(--border)',
      }}
    >
      <div className="skeleton h-3 w-20 mb-4" />
      <div className="skeleton h-7 w-28 mb-2" />
      <div className="skeleton h-3 w-16" />
    </div>
  )
}

export default function Dashboard() {
  const { data: instances = [], isLoading: loadingInstances } = useQuery({
    queryKey: ['instances'],
    queryFn: instancesApi.list,
    refetchInterval: 5000,
  })

  const { data: summary, isLoading: loadingSummary } = useQuery({
    queryKey: ['stats-summary'],
    queryFn: statsApi.summary,
    refetchInterval: 10000,
  })

  const connectedInstances = instances.filter((i: any) => i.status?.connected)
  const totalUpSpeed = connectedInstances.reduce((sum: number, i: any) => sum + (i.status?.up_speed || 0), 0)
  const totalDlSpeed = connectedInstances.reduce((sum: number, i: any) => sum + (i.status?.dl_speed || 0), 0)
  const totalTorrents = connectedInstances.reduce((sum: number, i: any) => sum + (i.status?.total || 0), 0)
  const activeTorrents = connectedInstances.reduce((sum: number, i: any) => sum + (i.status?.active || 0), 0)

  return (
    <div className="max-w-7xl mx-auto" style={{ animation: 'fadeIn 0.4s ease-out' }}>
      {/* Hero Header */}
      <div
        className="relative rounded-3xl p-8 mb-8 overflow-hidden"
        style={{
          background: 'linear-gradient(135deg, rgba(99,102,241,0.12) 0%, rgba(139,92,246,0.08) 50%, rgba(99,102,241,0.04) 100%)',
          border: '1px solid rgba(99,102,241,0.15)',
        }}
      >
        <div
          className="absolute -top-20 -right-20 w-64 h-64 rounded-full opacity-30 blur-3xl pointer-events-none"
          style={{ background: 'radial-gradient(circle, var(--accent) 0%, transparent 70%)' }}
        />
        <div
          className="absolute -bottom-16 -left-16 w-48 h-48 rounded-full opacity-20 blur-3xl pointer-events-none"
          style={{ background: 'radial-gradient(circle, var(--accent-secondary) 0%, transparent 70%)' }}
        />
        <div className="relative">
          <div className="flex items-center gap-3 mb-2">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{
                background: 'linear-gradient(135deg, var(--accent), var(--accent-secondary))',
                boxShadow: '0 4px 16px var(--accent-glow)',
              }}
            >
              <TrendingUp size={20} className="text-white" />
            </div>
            <h1 className="text-3xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
              仪表盘
            </h1>
          </div>
          <p className="text-sm font-medium ml-[52px]" style={{ color: 'var(--text-secondary)' }}>
            系统运行状态概览 · {connectedInstances.length} 个实例在线
          </p>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {loadingInstances ? (
          <>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </>
        ) : (
          <>
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
          </>
        )}
      </div>

      {/* Today Summary */}
      {loadingSummary ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : summary && (
        <div className="mb-8">
          <h2 className="text-xs font-semibold tracking-widest uppercase mb-4 px-1" style={{ color: 'var(--text-muted)' }}>
            今日摘要
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatusCard
              title="今日上传"
              value={formatBytes(summary.today_uploaded_bytes || 0)}
              icon={<Zap size={16} />}
              accent="var(--accent-secondary)"
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
        </div>
      )}

      {/* Instance List */}
      <div>
        <h2 className="text-xs font-semibold tracking-widest uppercase mb-4 px-1" style={{ color: 'var(--text-muted)' }}>
          实例状态
        </h2>
        <div
          className="rounded-2xl overflow-hidden"
          style={{
            background: 'var(--bg-card)',
            backdropFilter: 'blur(16px)',
            border: '1px solid var(--border)',
            boxShadow: '0 4px 24px rgba(0,0,0,0.15)',
          }}
        >
          {loadingInstances ? (
            <div className="p-6 space-y-4">
              {[1, 2, 3].map((n) => (
                <div key={n} className="flex items-center gap-4">
                  <div className="skeleton w-3 h-3 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <div className="skeleton h-4 w-32" />
                    <div className="skeleton h-3 w-48" />
                  </div>
                </div>
              ))}
            </div>
          ) : instances.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
                style={{ background: 'var(--bg-elevated)' }}
              >
                <Server size={28} style={{ color: 'var(--text-muted)' }} />
              </div>
              <p className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>暂无实例</p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                前往「实例管理」添加 qBittorrent 实例
              </p>
            </div>
          ) : (
            instances.map((inst: any, idx: number) => (
              <div
                key={inst.id}
                className="flex items-center justify-between px-6 py-4 transition-all duration-200 cursor-default"
                style={{
                  borderBottom: idx < instances.length - 1 ? '1px solid var(--border)' : 'none',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
              >
                <div className="flex items-center gap-4">
                  <div className="relative flex items-center justify-center w-4 h-4">
                    {inst.status?.connected && (
                      <div
                        className="absolute inset-0 rounded-full animate-ping opacity-30"
                        style={{ background: 'var(--success)' }}
                      />
                    )}
                    <div
                      className="w-2.5 h-2.5 rounded-full relative z-10"
                      style={{
                        background: inst.status?.connected ? 'var(--success)' : 'var(--danger)',
                        boxShadow: inst.status?.connected
                          ? '0 0 8px var(--success-glow)'
                          : '0 0 8px rgba(239,68,68,0.3)',
                      }}
                    />
                  </div>
                  <div>
                    <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{inst.name}</p>
                    <p className="text-xs mt-0.5 font-mono" style={{ color: 'var(--text-muted)' }}>{inst.url}</p>
                  </div>
                </div>

                {inst.status?.connected ? (
                  <div className="flex items-center gap-6">
                    <div className="flex items-center gap-1.5 text-xs font-medium" style={{ color: 'var(--success)' }}>
                      <Upload size={12} />
                      {formatSpeed(inst.status.up_speed || 0)}
                    </div>
                    <div className="flex items-center gap-1.5 text-xs font-medium" style={{ color: 'var(--accent)' }}>
                      <Download size={12} />
                      {formatSpeed(inst.status.dl_speed || 0)}
                    </div>
                    <div
                      className="px-2.5 py-1 rounded-lg text-[11px] font-semibold"
                      style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
                    >
                      {inst.status.total || 0} 种子
                    </div>
                  </div>
                ) : (
                  <span
                    className="px-2.5 py-1 rounded-lg text-[11px] font-semibold"
                    style={{ background: 'rgba(239,68,68,0.1)', color: 'var(--danger)' }}
                  >
                    离线
                  </span>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
