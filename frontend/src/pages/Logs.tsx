import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { statsApi } from '../api/client'
import { ChevronLeft, ChevronRight } from 'lucide-react'

const actionLabels: Record<string, { label: string; color: string }> = {
  add: { label: '添加', color: 'var(--ctp-teal)' },
  delete: { label: '删除', color: 'var(--ctp-red)' },
  pause: { label: '暂停', color: 'var(--ctp-peach)' },
  resume: { label: '恢复', color: 'var(--ctp-green)' },
  ban: { label: '封禁', color: 'var(--ctp-red)' },
  alert: { label: '告警', color: 'var(--ctp-yellow)' },
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
    <div className="max-w-5xl mx-auto" style={{ animation: 'fadeIn 0.3s ease-out' }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-12">
        <div>
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--ctp-text)' }}>操作日志</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--ctp-subtext0)' }}>查看系统自动管理操作记录</p>
        </div>
        <select
          value={filter || ''}
          onChange={(e) => { setFilter(e.target.value || undefined); setPage(0) }}
          className="outline-none cursor-pointer transition-colors duration-150"
          style={{
            padding: '8px 14px',
            borderRadius: '8px',
            fontSize: '13px',
            background: 'var(--ctp-surface0)',
            border: '1px solid var(--ctp-surface1)',
            color: 'var(--ctp-text)',
          }}
        >
          <option value="">全部类型</option>
          {Object.entries(actionLabels).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>

      {/* Log List */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 py-3">
              <div className="h-3 w-12 rounded" style={{ background: 'var(--ctp-surface1)' }} />
              <div className="flex-1 h-3 rounded" style={{ background: 'var(--ctp-surface1)' }} />
              <div className="h-3 w-24 rounded" style={{ background: 'var(--ctp-surface1)' }} />
            </div>
          ))}
        </div>
      ) : (!data || data.logs.length === 0) ? (
        <div className="py-16 text-center">
          <p className="text-sm" style={{ color: 'var(--ctp-overlay1)' }}>暂无日志</p>
        </div>
      ) : (
        <>
          <div style={{
            background: 'var(--ctp-surface0)',
            border: '1px solid var(--ctp-surface1)',
            borderRadius: '12px',
            overflow: 'hidden',
          }}>
            {data.logs.map((log: any, idx: number) => {
              const a = actionLabels[log.action] || { label: log.action, color: 'var(--ctp-subtext0)' }
              return (
                <div
                  key={log.id}
                  className="flex items-center gap-4 px-6 py-3.5 transition-colors duration-150"
                  style={{ borderBottom: idx < data.logs.length - 1 ? '1px solid var(--ctp-surface0)' : 'none' }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--ctp-surface0)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                >
                  <span className="text-xs font-medium shrink-0 w-12" style={{ color: a.color }}>
                    {a.label}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate" style={{ color: 'var(--ctp-text)' }}>
                      {log.torrent_name || '—'}
                    </p>
                    {log.details && (
                      <p className="text-xs truncate mt-0.5" style={{ color: 'var(--ctp-overlay1)' }}>{log.details}</p>
                    )}
                  </div>
                  <time className="text-xs shrink-0 tabular-nums"
                    style={{ color: 'var(--ctp-overlay1)', fontFamily: '"Geist Mono", monospace' }}>
                    {log.timestamp ? new Date(log.timestamp).toLocaleString('zh-CN', {
                      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
                    }) : '—'}
                  </time>
                </div>
              )
            })}
          </div>

          {/* Pagination */}
          {data.total > limit && (
            <div className="flex items-center justify-center gap-4 mt-6">
              <button
                disabled={page === 0}
                onClick={() => setPage(p => p - 1)}
                className="flex items-center gap-1 cursor-pointer transition-colors duration-150 disabled:opacity-30"
                style={{ color: 'var(--ctp-subtext0)', background: 'none', border: 'none', fontSize: '13px' }}
              >
                <ChevronLeft size={14} /> 上一页
              </button>
              <span className="text-xs tabular-nums" style={{ color: 'var(--ctp-overlay1)' }}>
                {page + 1} / {totalPages}
              </span>
              <button
                disabled={(page + 1) * limit >= data.total}
                onClick={() => setPage(p => p + 1)}
                className="flex items-center gap-1 cursor-pointer transition-colors duration-150 disabled:opacity-30"
                style={{ color: 'var(--ctp-subtext0)', background: 'none', border: 'none', fontSize: '13px' }}
              >
                下一页 <ChevronRight size={14} />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
