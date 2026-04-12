import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { statsApi } from '../api/client'
import { ScrollText, Filter } from 'lucide-react'

const actionLabels: Record<string, { label: string; color: string }> = {
  add: { label: '添加', color: 'var(--accent)' },
  delete: { label: '删除', color: 'var(--danger)' },
  pause: { label: '暂停', color: 'var(--warning)' },
  resume: { label: '恢复', color: 'var(--success)' },
  ban: { label: '封禁', color: '#ef4444' },
  alert: { label: '告警', color: '#f59e0b' },
}

export default function Logs() {
  const [filter, setFilter] = useState<string | undefined>()
  const [page, setPage] = useState(0)
  const limit = 30

  const { data } = useQuery({
    queryKey: ['logs', filter, page],
    queryFn: () => statsApi.logs({ limit, offset: page * limit, action: filter }),
  })

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>操作日志</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>查看系统自动管理操作记录</p>
        </div>
        <div className="flex items-center gap-2">
          <Filter size={14} style={{ color: 'var(--text-muted)' }} />
          <select value={filter || ''} onChange={(e) => { setFilter(e.target.value || undefined); setPage(0) }}
            className="px-3 py-2 rounded-lg text-sm outline-none"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
            <option value="">全部</option>
            {Object.entries(actionLabels).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
      </div>

      <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
        {(!data || data.logs.length === 0) ? (
          <div className="p-12 text-center" style={{ color: 'var(--text-muted)' }}>
            <ScrollText size={32} className="mx-auto mb-3 opacity-40" />
            <p className="text-sm">暂无日志记录</p>
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
            {data.logs.map((log: any) => {
              const a = actionLabels[log.action] || { label: log.action, color: 'var(--text-muted)' }
              return (
                <div key={log.id} className="flex items-center gap-4 px-5 py-3 transition-colors"
                  onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                  <span className="px-2 py-0.5 rounded text-[11px] font-semibold uppercase tracking-wide"
                    style={{ background: `${a.color}15`, color: a.color }}>
                    {a.label}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>{log.torrent_name || '—'}</p>
                    <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{log.details}</p>
                  </div>
                  <time className="text-xs shrink-0" style={{ color: 'var(--text-muted)' }}>
                    {log.timestamp ? new Date(log.timestamp).toLocaleString('zh-CN') : '—'}
                  </time>
                </div>
              )
            })}
          </div>
        )}

        {data && data.total > limit && (
          <div className="flex items-center justify-between px-5 py-3 border-t" style={{ borderColor: 'var(--border)' }}>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>共 {data.total} 条</span>
            <div className="flex gap-2">
              <button disabled={page === 0} onClick={() => setPage(p => p - 1)}
                className="px-3 py-1.5 rounded-lg text-xs cursor-pointer disabled:opacity-30"
                style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>上一页</button>
              <button disabled={(page + 1) * limit >= data.total} onClick={() => setPage(p => p + 1)}
                className="px-3 py-1.5 rounded-lg text-xs cursor-pointer disabled:opacity-30"
                style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>下一页</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
