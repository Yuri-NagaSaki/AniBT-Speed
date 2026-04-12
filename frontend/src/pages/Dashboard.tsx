import { useQuery } from '@tanstack/react-query'
import { instancesApi, statsApi } from '../api/client'
import StatusCard from '../components/StatusCard'
import { Upload, Download } from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}

function formatSpeed(bytesPerSec: number): string {
  return `${formatBytes(bytesPerSec)}/s`
}

export default function Dashboard() {
  const { data: instances = [], isLoading: loadingInstances } = useQuery({
    queryKey: ['instances'],
    queryFn: instancesApi.list,
    refetchInterval: 5000,
  })

  const { data: traffic = [] } = useQuery<any[]>({
    queryKey: ['traffic'],
    queryFn: () => statsApi.traffic(),
    refetchInterval: 60000,
  })

  const chartData = traffic.map((r: any) => ({
    time: new Date(r.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
    upload: +(r.uploaded / 1024 / 1024).toFixed(1),
    download: +(r.downloaded / 1024 / 1024).toFixed(1),
  }))

  const { data: summary } = useQuery({
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
    <div className="max-w-6xl mx-auto" style={{ animation: 'fadeIn 0.3s ease-out' }}>
      {/* Page header */}
      <div className="mb-12">
        <h1 className="text-2xl font-semibold" style={{ color: 'var(--ctp-text)' }}>仪表盘</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--ctp-subtext0)' }}>
          系统运行状态概览 · {connectedInstances.length} 个实例在线
        </p>
      </div>

      {/* Stats Grid */}
      <div
        className="grid gap-6 mb-12"
        style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}
      >
        {loadingInstances ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="py-3">
              <div className="h-3 w-16 rounded mb-3" style={{ background: 'var(--ctp-surface0)' }} />
              <div className="h-6 w-24 rounded" style={{ background: 'var(--ctp-surface0)' }} />
            </div>
          ))
        ) : (
          <>
            <StatusCard title="上传速度" value={formatSpeed(totalUpSpeed)} subtitle="全部实例合计" accent="var(--ctp-green)" />
            <StatusCard title="下载速度" value={formatSpeed(totalDlSpeed)} subtitle="全部实例合计" accent="var(--ctp-teal)" />
            <StatusCard title="活跃种子" value={`${activeTorrents} / ${totalTorrents}`} subtitle="活跃 / 总计" />
            <StatusCard title="实例状态" value={`${connectedInstances.length} / ${instances.length}`} subtitle="在线 / 总计" />
          </>
        )}
      </div>

      {/* Today summary */}
      {summary && (
        <div className="flex items-center gap-8 mb-12">
          <div>
            <span className="text-xs block mb-1" style={{ color: 'var(--ctp-overlay1)' }}>今日上传</span>
            <span className="text-sm font-medium" style={{ color: 'var(--ctp-text)' }}>{formatBytes(summary.today_uploaded_bytes || 0)}</span>
          </div>
          <div style={{ width: '1px', height: '24px', background: 'var(--ctp-surface1)' }} />
          <div>
            <span className="text-xs block mb-1" style={{ color: 'var(--ctp-overlay1)' }}>今日下载</span>
            <span className="text-sm font-medium" style={{ color: 'var(--ctp-text)' }}>{formatBytes(summary.today_downloaded_bytes || 0)}</span>
          </div>
          <div style={{ width: '1px', height: '24px', background: 'var(--ctp-surface1)' }} />
          <div>
            <span className="text-xs block mb-1" style={{ color: 'var(--ctp-overlay1)' }}>今日操作</span>
            <span className="text-sm font-medium" style={{ color: 'var(--ctp-text)' }}>{summary.today_actions || 0}</span>
          </div>
        </div>
      )}

      {/* Traffic chart */}
      {chartData.length > 0 && (
        <div className="mb-12">
          <h2 className="text-xs font-medium tracking-widest uppercase mb-4" style={{ color: 'var(--ctp-subtext0)' }}>
            流量趋势
          </h2>
          <div
            style={{
              background: 'var(--ctp-surface0)',
              border: '1px solid var(--ctp-surface1)',
              borderRadius: '12px',
              padding: '24px',
            }}
          >
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="uploadGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#a6e3a1" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#a6e3a1" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="downloadGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#94e2d5" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#94e2d5" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="time"
                  stroke="#7f849c"
                  tick={{ fontSize: 11, fill: '#7f849c' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  stroke="#7f849c"
                  tick={{ fontSize: 11, fill: '#7f849c' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => `${v} MB`}
                />
                <Tooltip
                  contentStyle={{
                    background: '#313244',
                    border: '1px solid #45475a',
                    borderRadius: '8px',
                    fontSize: '12px',
                    color: '#cdd6f4',
                  }}
                  formatter={(value: any, name: any) => [`${value} MB`, name === 'upload' ? '上传' : '下载']}
                />
                <Area type="monotone" dataKey="upload" stroke="#a6e3a1" strokeWidth={1.5} fill="url(#uploadGrad)" dot={false} />
                <Area type="monotone" dataKey="download" stroke="#94e2d5" strokeWidth={1.5} fill="url(#downloadGrad)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Instance list */}
      <div>
        <h2 className="text-xs font-medium tracking-widest uppercase mb-4" style={{ color: 'var(--ctp-subtext0)' }}>
          实例状态
        </h2>
        <div
          style={{
            background: 'var(--ctp-surface0)',
            border: '1px solid var(--ctp-surface1)',
            borderRadius: '12px',
            overflow: 'hidden',
          }}
        >
          {loadingInstances ? (
            <div className="p-6 space-y-4">
              {[1, 2, 3].map((n) => (
                <div key={n} className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full" style={{ background: 'var(--ctp-surface1)' }} />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-28 rounded" style={{ background: 'var(--ctp-surface1)' }} />
                    <div className="h-2.5 w-44 rounded" style={{ background: 'var(--ctp-surface1)' }} />
                  </div>
                </div>
              ))}
            </div>
          ) : instances.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <p className="text-sm" style={{ color: 'var(--ctp-overlay1)' }}>暂无实例</p>
              <p className="text-xs mt-1" style={{ color: 'var(--ctp-overlay0)' }}>
                前往「实例管理」添加 qBittorrent 实例
              </p>
            </div>
          ) : (
            instances.map((inst: any, idx: number) => (
              <div
                key={inst.id}
                className="flex items-center justify-between px-6 py-4 transition-colors duration-150"
                style={{
                  borderBottom: idx < instances.length - 1 ? '1px solid var(--ctp-surface0)' : 'none',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--ctp-surface0)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{ background: inst.status?.connected ? 'var(--ctp-green)' : 'var(--ctp-red)' }}
                  />
                  <div>
                    <p className="text-sm font-medium" style={{ color: 'var(--ctp-text)' }}>{inst.name}</p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--ctp-overlay1)', fontFamily: '"Geist Mono", monospace' }}>{inst.url}</p>
                  </div>
                </div>

                {inst.status?.connected ? (
                  <div className="flex items-center gap-5">
                    <div className="flex items-center gap-1.5 text-xs font-medium" style={{ color: 'var(--ctp-green)' }}>
                      <Upload size={11} />
                      {formatSpeed(inst.status.up_speed || 0)}
                    </div>
                    <div className="flex items-center gap-1.5 text-xs font-medium" style={{ color: 'var(--ctp-teal)' }}>
                      <Download size={11} />
                      {formatSpeed(inst.status.dl_speed || 0)}
                    </div>
                    <span className="text-xs" style={{ color: 'var(--ctp-subtext0)' }}>
                      {inst.status.total || 0} 种子
                    </span>
                  </div>
                ) : (
                  <span className="text-xs" style={{ color: 'var(--ctp-red)' }}>离线</span>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
