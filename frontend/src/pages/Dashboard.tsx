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
    staleTime: 2000,
  })

  const { data: traffic = [], isLoading: loadingTraffic } = useQuery<any[]>({
    queryKey: ['traffic'],
    queryFn: () => statsApi.traffic(),
    refetchInterval: 60000,
    staleTime: 30000,
  })

  const chartData = traffic.map((r: any) => ({
    time: new Date(r.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
    upload: +(r.uploaded / 1024 / 1024).toFixed(1),
    download: +(r.downloaded / 1024 / 1024).toFixed(1),
  }))

  const { data: summary, isLoading: loadingSummary } = useQuery({
    queryKey: ['stats-summary'],
    queryFn: statsApi.summary,
    refetchInterval: 10000,
    staleTime: 5000,
  })

  const connectedInstances = instances.filter((i: any) => i.status?.connected)
  const totalUpSpeed = connectedInstances.reduce((sum: number, i: any) => sum + (i.status?.up_speed || 0), 0)
  const totalDlSpeed = connectedInstances.reduce((sum: number, i: any) => sum + (i.status?.dl_speed || 0), 0)
  const totalTorrents = connectedInstances.reduce((sum: number, i: any) => sum + (i.status?.total || 0), 0)
  const activeTorrents = connectedInstances.reduce((sum: number, i: any) => sum + (i.status?.active || 0), 0)

  return (
    <div style={{ animation: 'fadeIn 0.3s ease-out' }}>
      {/* Page header */}
      <div style={{ marginBottom: 48 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, color: 'var(--ctp-text)', letterSpacing: '-0.02em', lineHeight: 1.3 }}>
          仪表盘
        </h1>
        <p style={{ fontSize: 14, color: 'var(--ctp-subtext0)', marginTop: 8, lineHeight: 1.6 }}>
          系统运行状态概览 · {connectedInstances.length} 个实例在线
        </p>
      </div>

      {/* Stats Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
        gap: 32,
        marginBottom: 56,
      }}>
        {loadingInstances ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} style={{ padding: '24px 0' }}>
              <div style={{ height: 12, width: 64, borderRadius: 4, background: 'var(--ctp-surface0)', marginBottom: 16 }} />
              <div style={{ height: 24, width: 96, borderRadius: 4, background: 'var(--ctp-surface0)' }} />
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 56, flexWrap: 'wrap' }}>
        {loadingSummary ? (
          <>
            {[1, 2, 3].map((n) => (
              <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div>
                  <div style={{ height: 10, width: 48, borderRadius: 4, background: 'var(--ctp-surface0)', marginBottom: 8 }} />
                  <div style={{ height: 14, width: 72, borderRadius: 4, background: 'var(--ctp-surface0)' }} />
                </div>
                {n < 3 && <div style={{ width: 1, height: 28, background: 'var(--ctp-surface1)' }} />}
              </div>
            ))}
          </>
        ) : summary ? (
          <>
            <div>
              <span style={{ fontSize: 12, display: 'block', marginBottom: 6, color: 'var(--ctp-overlay1)' }}>今日上传</span>
              <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--ctp-text)' }}>{formatBytes(summary.today_uploaded_bytes || 0)}</span>
            </div>
            <div style={{ width: 1, height: 28, background: 'var(--ctp-surface1)' }} />
            <div>
              <span style={{ fontSize: 12, display: 'block', marginBottom: 6, color: 'var(--ctp-overlay1)' }}>今日下载</span>
              <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--ctp-text)' }}>{formatBytes(summary.today_downloaded_bytes || 0)}</span>
            </div>
            <div style={{ width: 1, height: 28, background: 'var(--ctp-surface1)' }} />
            <div>
              <span style={{ fontSize: 12, display: 'block', marginBottom: 6, color: 'var(--ctp-overlay1)' }}>今日操作</span>
              <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--ctp-text)' }}>{summary.today_actions || 0}</span>
            </div>
          </>
        ) : null}
      </div>

      {/* Traffic chart */}
      <div style={{ marginBottom: 56 }}>
        <div style={{
          fontSize: 12,
          fontWeight: 500,
          textTransform: 'uppercase' as const,
          letterSpacing: '0.1em',
          color: 'var(--ctp-overlay1)',
          marginBottom: 24,
        }}>
          流量趋势
        </div>
        <div style={{
          background: 'var(--ctp-surface0)',
          border: '1px solid var(--ctp-surface1)',
          borderRadius: 14,
          padding: '24px 32px 32px 32px',
        }}>
          {loadingTraffic ? (
            <div style={{ height: 240, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: 13, color: 'var(--ctp-overlay0)' }}>加载流量数据...</span>
            </div>
          ) : chartData.length === 0 ? (
            <div style={{ height: 240, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: 13, color: 'var(--ctp-overlay0)' }}>暂无流量数据</span>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={chartData} margin={{ top: 16, right: 8, bottom: 0, left: 0 }}>
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
                  width={60}
                />
                <Tooltip
                  contentStyle={{
                    background: '#313244',
                    border: '1px solid #45475a',
                    borderRadius: '10px',
                    fontSize: '13px',
                    padding: '12px 16px',
                    color: '#cdd6f4',
                  }}
                  formatter={(value: any, name: any) => [`${value} MB`, name === 'upload' ? '上传' : '下载']}
                />
                <Area type="monotone" dataKey="upload" stroke="#a6e3a1" strokeWidth={1.5} fill="url(#uploadGrad)" dot={false} />
                <Area type="monotone" dataKey="download" stroke="#94e2d5" strokeWidth={1.5} fill="url(#downloadGrad)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Instance list */}
      <div>
        <div style={{
          fontSize: 12,
          fontWeight: 500,
          textTransform: 'uppercase' as const,
          letterSpacing: '0.1em',
          color: 'var(--ctp-overlay1)',
          marginBottom: 24,
        }}>
          实例状态
        </div>

        {loadingInstances ? (
          <div>
            {[1, 2, 3].map((n) => (
              <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '20px 0' }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--ctp-surface1)' }} />
                <div>
                  <div style={{ height: 14, width: 112, borderRadius: 4, background: 'var(--ctp-surface1)', marginBottom: 8 }} />
                  <div style={{ height: 12, width: 176, borderRadius: 4, background: 'var(--ctp-surface1)' }} />
                </div>
              </div>
            ))}
          </div>
        ) : instances.length === 0 ? (
          <div style={{ padding: '64px 0', textAlign: 'center' as const }}>
            <p style={{ fontSize: 14, color: 'var(--ctp-overlay1)' }}>暂无实例</p>
            <p style={{ fontSize: 12, color: 'var(--ctp-overlay0)', marginTop: 8 }}>
              前往「实例管理」添加 qBittorrent 实例
            </p>
          </div>
        ) : (
          <div>
            {instances.map((inst: any, idx: number) => (
              <div
                key={inst.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '20px 0',
                  borderBottom: idx < instances.length - 1 ? '1px solid var(--ctp-surface0)' : 'none',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div style={{
                    width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                    background: inst.status?.connected ? 'var(--ctp-green)' : 'var(--ctp-red)',
                  }} />
                  <div>
                    <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--ctp-text)', lineHeight: 1.4 }}>
                      {inst.name}
                    </p>
                    <p style={{
                      fontSize: 12, color: 'var(--ctp-overlay1)', marginTop: 4,
                      fontFamily: '"Geist Mono", monospace',
                    }}>
                      {inst.url}
                    </p>
                  </div>
                </div>

                {inst.status?.connected ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 500, color: 'var(--ctp-green)' }}>
                      <Upload size={12} />
                      {formatSpeed(inst.status.up_speed || 0)}
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 500, color: 'var(--ctp-teal)' }}>
                      <Download size={12} />
                      {formatSpeed(inst.status.dl_speed || 0)}
                    </span>
                    <span style={{ fontSize: 13, color: 'var(--ctp-subtext0)' }}>
                      {inst.status.total || 0} 种子
                    </span>
                  </div>
                ) : (
                  <span style={{ fontSize: 13, color: 'var(--ctp-red)' }}>离线</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
