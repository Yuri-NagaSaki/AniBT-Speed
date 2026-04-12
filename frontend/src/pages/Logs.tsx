import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { statsApi } from '../api/client'
import { Filter, ChevronLeft, ChevronRight, FileText } from 'lucide-react'

const actionLabels: Record<string, { label: string; color: string; bg: string }> = {
  add: { label: '添加', color: 'var(--accent)', bg: 'rgba(99,102,241,0.12)' },
  delete: { label: '删除', color: 'var(--danger)', bg: 'rgba(239,68,68,0.12)' },
  pause: { label: '暂停', color: 'var(--warning)', bg: 'rgba(245,158,11,0.12)' },
  resume: { label: '恢复', color: 'var(--success)', bg: 'rgba(34,197,94,0.12)' },
  ban: { label: '封禁', color: '#f43f5e', bg: 'rgba(244,63,94,0.12)' },
  alert: { label: '告警', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
}

export default function Logs() {
  const [filter, setFilter] = useState<string | undefined>()
  const [page, setPage] = useState(0)
  const limit = 30

  const { data, isLoading } = useQuery({
    queryKey: ['logs', filter, page],
    queryFn: () => statsApi.logs({ limit, offset: page * limit, action: filter }),
  })

  const totalPages = data ? Math.ceil(data.total / limit) : 0

  return (
    <div className="max-w-5xl mx-auto" style={{ animation: 'fadeIn 0.4s ease-out' }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>操作日志</h1>
          <p className="text-sm mt-1.5 font-medium" style={{ color: 'var(--text-secondary)' }}>查看系统自动管理操作记录</p>
        </div>
        <div className="flex items-center gap-2.5">
          <Filter size={14} style={{ color: 'var(--text-muted)' }} />
          <select
            value={filter || ''}
            onChange={(e) => { setFilter(e.target.value || undefined); setPage(0) }}
            className="px-4 py-2.5 rounded-xl text-sm outline-none transition-all duration-200 cursor-pointer"
            style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              color: 'var(--text-primary)',
              backdropFilter: 'blur(8px)',
            }}
          >
            <option value="">全部类型</option>
            {Object.entries(actionLabels).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
      </div>

      {/* Log List */}
      <div
        className="rounded-2xl overflow-hidden"
        style={{
          background: 'var(--bg-card)',
          backdropFilter: 'blur(16px)',
          border: '1px solid var(--border)',
          boxShadow: '0 4px 24px rgba(0,0,0,0.15)',
        }}
      >
        {isLoading ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <div className="skeleton h-6 w-12 rounded-md" />
                <div className="flex-1 space-y-1.5">
                  <div className="skeleton h-4 w-2/3" />
                  <div className="skeleton h-3 w-1/3" />
                </div>
                <div className="skeleton h-3 w-24" />
              </div>
            ))}
          </div>
        ) : (!data || data.logs.length === 0) ? (
          <div className="px-6 py-20 text-center">
            <div
              className="w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-5"
              style={{ background: 'var(--bg-elevated)' }}
            >
              <FileText size={32} style={{ color: 'var(--text-muted)' }} />
            </div>
            <p className="text-base font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>暂无日志记录</p>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>系统操作记录将在此处显示</p>
          </div>
        ) : (
          <>
            {data.logs.map((log: any, idx: number) => {
              const a = actionLabels[log.action] || { label: log.action, color: 'var(--text-muted)', bg: 'var(--bg-elevated)' }
              return (
                <div
                  key={log.id}
                  className="flex items-center gap-4 px-6 py-3.5 transition-all duration-200"
                  style={{
                    borderBottom: idx < data.logs.length - 1 ? '1px solid var(--border)' : 'none',
                    animation: `slideUp ${0.1 + idx * 0.02}s ease-out both`,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                >
                  <span
                    className="px-2.5 py-1 rounded-lg text-[11px] font-bold uppercase tracking-wider shrink-0"
                    style={{ background: a.bg, color: a.color }}
                  >
                    {a.label}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                      {log.torrent_name || '—'}
                    </p>
                    {log.details && (
                      <p className="text-xs truncate mt-0.5" style={{ color: 'var(--text-muted)' }}>{log.details}</p>
                    )}
                  </div>
                  <time
                    className="text-[11px] font-medium shrink-0 tabular-nums"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {log.timestamp ? new Date(log.timestamp).toLocaleString('zh-CN', {
                      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
                    }) : '—'}
                  </time>
                </div>
              )
            })}

            {/* Pagination */}
            {data.total > limit && (
              <div className="flex items-center justify-between px-6 py-4" style={{ borderTop: '1px solid var(--border)' }}>
                <span className="text-xs font-medium tabular-nums" style={{ color: 'var(--text-muted)' }}>
                  共 {data.total} 条 · 第 {page + 1} / {totalPages} 页
                </span>
                <div className="flex gap-2">
                  <button
                    disabled={page === 0}
                    onClick={() => setPage(p => p - 1)}
                    className="flex items-center gap-1 px-3.5 py-2 rounded-xl text-xs font-medium cursor-pointer transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed"
                    style={{
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--border)',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    <ChevronLeft size={12} /> 上一页
                  </button>
                  <button
                    disabled={(page + 1) * limit >= data.total}
                    onClick={() => setPage(p => p + 1)}
                    className="flex items-center gap-1 px-3.5 py-2 rounded-xl text-xs font-medium cursor-pointer transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed"
                    style={{
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--border)',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    下一页 <ChevronRight size={12} />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
