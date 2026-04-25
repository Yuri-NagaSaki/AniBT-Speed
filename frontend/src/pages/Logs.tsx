import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { statsApi } from '../api/client'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { PageHeader } from '../components/ui'

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
    staleTime: 10000,
  })

  const totalPages = data ? Math.ceil(data.total / limit) : 0

  return (
    <div style={{ animation: 'fadeIn 0.3s ease-out' }}>
      <PageHeader
        title="操作日志"
        description="查看系统自动管理操作记录"
        kicker="Audit trail"
        actions={(
          <select
            value={filter || ''}
            onChange={(e) => { setFilter(e.target.value || undefined); setPage(0) }}
            className="input"
            style={{ width: 150, cursor: 'pointer' }}
          >
            <option value="">全部类型</option>
            {Object.entries(actionLabels).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        )}
      />

      {/* Log List */}
      {isLoading ? (
        <div>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '20px 0' }}>
              <div style={{ height: 14, width: 48, borderRadius: 4, background: 'var(--ctp-surface1)' }} />
              <div style={{ flex: 1, height: 14, borderRadius: 4, background: 'var(--ctp-surface1)' }} />
              <div style={{ height: 14, width: 96, borderRadius: 4, background: 'var(--ctp-surface1)' }} />
            </div>
          ))}
        </div>
      ) : (!data || data.logs.length === 0) ? (
        <div style={{ padding: '64px 0', textAlign: 'center' as const }}>
          <p style={{ fontSize: 14, color: 'var(--ctp-overlay1)' }}>暂无日志</p>
        </div>
      ) : (
        <>
          <div className="entity-list">
            {data.logs.map((log: any, idx: number) => {
              const a = actionLabels[log.action] || { label: log.action, color: 'var(--ctp-subtext0)' }
              return (
                <div
                  key={log.id}
                  className="log-row"
                  style={{
                    borderBottom: idx < data.logs.length - 1 ? '1px solid var(--line-soft)' : 'none',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(69,71,90,0.3)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                >
                  <span style={{
                    fontSize: 13, fontWeight: 500, flexShrink: 0, width: 48,
                    color: a.color,
                  }}>
                    {a.label}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <p style={{
                      fontSize: 14, color: 'var(--ctp-text)', lineHeight: 1.4,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const,
                    }}>
                      {log.torrent_name || '—'}
                    </p>
                    {log.details && (
                      <p style={{
                        fontSize: 12, color: 'var(--ctp-overlay1)', marginTop: 4,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const,
                      }}>{log.details}</p>
                    )}
                  </div>
                  <time style={{
                    fontSize: 12, flexShrink: 0,
                    color: 'var(--ctp-overlay1)',
                    fontFamily: '"Geist Mono", monospace',
                    fontVariantNumeric: 'tabular-nums',
                  }}>
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
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              gap: 16, marginTop: 40,
            }}>
              <button
                disabled={page === 0}
                onClick={() => setPage(p => p - 1)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '10px 16px', borderRadius: 8,
                  background: 'none', border: 'none', cursor: page === 0 ? 'default' : 'pointer',
                  fontSize: 13, fontFamily: 'inherit',
                  color: 'var(--ctp-subtext0)',
                  opacity: page === 0 ? 0.3 : 1,
                  transition: 'opacity 0.15s ease',
                }}
              >
                <ChevronLeft size={14} /> 上一页
              </button>
              <span style={{
                fontSize: 12, color: 'var(--ctp-overlay1)',
                fontVariantNumeric: 'tabular-nums',
              }}>
                {page + 1} / {totalPages}
              </span>
              <button
                disabled={(page + 1) * limit >= data.total}
                onClick={() => setPage(p => p + 1)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '10px 16px', borderRadius: 8,
                  background: 'none', border: 'none',
                  cursor: (page + 1) * limit >= data.total ? 'default' : 'pointer',
                  fontSize: 13, fontFamily: 'inherit',
                  color: 'var(--ctp-subtext0)',
                  opacity: (page + 1) * limit >= data.total ? 0.3 : 1,
                  transition: 'opacity 0.15s ease',
                }}
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
