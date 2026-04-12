import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { rssApi, instancesApi } from '../api/client'
import { Plus, Trash2, Pencil, X, Rss, FolderOpen, Clock, Power } from 'lucide-react'

export default function RSSManager() {
  const queryClient = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState({
    name: '', url: '', instance_id: 0, download_path: '',
    include_filter: '', exclude_filter: '', refresh_interval: 5, enabled: true,
  })
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)

  const { data: feeds = [], isLoading } = useQuery({ queryKey: ['rss'], queryFn: rssApi.list })
  const { data: instances = [] } = useQuery({ queryKey: ['instances'], queryFn: instancesApi.list })

  const createMutation = useMutation({
    mutationFn: rssApi.create,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['rss'] }); resetForm() },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: typeof form }) => rssApi.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['rss'] }); resetForm() },
  })

  const deleteMutation = useMutation({
    mutationFn: rssApi.delete,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['rss'] }); setDeleteConfirm(null) },
  })

  function resetForm() {
    setForm({ name: '', url: '', instance_id: instances[0]?.id || 0, download_path: '', include_filter: '', exclude_filter: '', refresh_interval: 5, enabled: true })
    setShowForm(false)
    setEditId(null)
  }

  function handleEdit(feed: any) {
    setForm({
      name: feed.name, url: feed.url, instance_id: feed.instance_id,
      download_path: feed.download_path || '', include_filter: feed.include_filter || '',
      exclude_filter: feed.exclude_filter || '', refresh_interval: feed.refresh_interval || 5,
      enabled: feed.enabled,
    })
    setEditId(feed.id)
    setShowForm(true)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (editId) {
      updateMutation.mutate({ id: editId, data: form })
    } else {
      createMutation.mutate(form)
    }
  }

  const inputStyle = {
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    color: 'var(--text-primary)',
  }

  const instanceName = (id: number) => instances.find((i: any) => i.id === id)?.name || `#${id}`

  return (
    <div className="max-w-5xl mx-auto" style={{ animation: 'fadeIn 0.4s ease-out' }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>RSS 管理</h1>
          <p className="text-sm mt-1.5 font-medium" style={{ color: 'var(--text-secondary)' }}>管理 RSS 订阅源和自动下载规则</p>
        </div>
        <button
          onClick={() => { resetForm(); setShowForm(true) }}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white cursor-pointer transition-all duration-300"
          style={{ background: 'var(--gradient-accent)', boxShadow: '0 4px 20px var(--accent-glow)' }}
          onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-1px)' }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)' }}
        >
          <Plus size={16} /> 添加 RSS
        </button>
      </div>

      {/* Add/Edit Form — slide-down panel */}
      {showForm && (
        <div
          className="rounded-2xl p-6 mb-6"
          style={{
            background: 'var(--bg-card)',
            backdropFilter: 'blur(16px)',
            border: '1px solid var(--border)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
            animation: 'slideUp 0.3s ease-out',
          }}
        >
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-3">
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center"
                style={{ background: 'var(--gradient-subtle)', border: '1px solid rgba(99,102,241,0.2)' }}
              >
                <Rss size={16} style={{ color: 'var(--accent)' }} />
              </div>
              <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                {editId ? '编辑 RSS 源' : '添加 RSS 源'}
              </h3>
            </div>
            <button onClick={resetForm} className="p-2 rounded-lg cursor-pointer transition-colors hover:bg-[var(--bg-hover)]" style={{ color: 'var(--text-muted)' }}>
              <X size={18} />
            </button>
          </div>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block">
              <span className="text-xs font-semibold mb-2 block tracking-wide" style={{ color: 'var(--text-secondary)' }}>名称</span>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Anibt"
                className="w-full px-4 py-2.5 rounded-xl text-sm outline-none transition-all duration-200" style={inputStyle}
                onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.boxShadow = '0 0 0 3px var(--accent-glow)' }}
                onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.boxShadow = 'none' }}
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold mb-2 block tracking-wide" style={{ color: 'var(--text-secondary)' }}>RSS URL</span>
              <input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://example.com/rss.xml"
                className="w-full px-4 py-2.5 rounded-xl text-sm outline-none transition-all duration-200" style={inputStyle}
                onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.boxShadow = '0 0 0 3px var(--accent-glow)' }}
                onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.boxShadow = 'none' }}
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold mb-2 block tracking-wide" style={{ color: 'var(--text-secondary)' }}>绑定实例</span>
              <select value={form.instance_id} onChange={(e) => setForm({ ...form, instance_id: Number(e.target.value) })}
                className="w-full px-4 py-2.5 rounded-xl text-sm outline-none transition-all duration-200" style={inputStyle}>
                <option value={0}>选择实例</option>
                {instances.map((i: any) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-semibold mb-2 block tracking-wide" style={{ color: 'var(--text-secondary)' }}>下载目录</span>
              <input value={form.download_path} onChange={(e) => setForm({ ...form, download_path: e.target.value })} placeholder="/AniBt"
                className="w-full px-4 py-2.5 rounded-xl text-sm outline-none transition-all duration-200" style={inputStyle}
                onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.boxShadow = '0 0 0 3px var(--accent-glow)' }}
                onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.boxShadow = 'none' }}
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold mb-2 block tracking-wide" style={{ color: 'var(--text-secondary)' }}>包含关键字</span>
              <input value={form.include_filter} onChange={(e) => setForm({ ...form, include_filter: e.target.value })} placeholder="留空表示全部"
                className="w-full px-4 py-2.5 rounded-xl text-sm outline-none transition-all duration-200" style={inputStyle}
                onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.boxShadow = '0 0 0 3px var(--accent-glow)' }}
                onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.boxShadow = 'none' }}
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold mb-2 block tracking-wide" style={{ color: 'var(--text-secondary)' }}>排除关键字</span>
              <input value={form.exclude_filter} onChange={(e) => setForm({ ...form, exclude_filter: e.target.value })} placeholder="DBD|搬运"
                className="w-full px-4 py-2.5 rounded-xl text-sm outline-none transition-all duration-200" style={inputStyle}
                onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.boxShadow = '0 0 0 3px var(--accent-glow)' }}
                onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.boxShadow = 'none' }}
              />
            </label>
            <div className="sm:col-span-2 flex items-center justify-between pt-2">
              <label className="flex items-center gap-3">
                <button type="button" onClick={() => setForm({ ...form, enabled: !form.enabled })}
                  className="relative w-12 h-7 rounded-full transition-all duration-300 cursor-pointer"
                  style={{
                    background: form.enabled ? 'linear-gradient(135deg, #6366f1, #8b5cf6)' : 'rgba(63,63,70,0.6)',
                    boxShadow: form.enabled ? '0 0 16px var(--accent-glow)' : 'inset 0 1px 3px rgba(0,0,0,0.3)',
                  }}>
                  <div className="absolute top-[3px] w-[22px] h-[22px] rounded-full bg-white shadow-lg transition-all duration-300"
                    style={{ left: form.enabled ? '25px' : '3px' }} />
                </button>
                <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                  {form.enabled ? '已启用' : '已禁用'}
                </span>
              </label>
              <div className="flex gap-3">
                <button type="button" onClick={resetForm}
                  className="px-4 py-2.5 rounded-xl text-sm font-medium cursor-pointer transition-all duration-200"
                  style={{ color: 'var(--text-secondary)', background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
                  取消
                </button>
                <button type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending}
                  className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white cursor-pointer transition-all duration-300 disabled:opacity-50"
                  style={{ background: 'var(--gradient-accent)', boxShadow: '0 4px 16px var(--accent-glow)' }}>
                  {editId ? '保存修改' : '添加源'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* Feed List */}
      {isLoading ? (
        <div className="space-y-4">
          {[1, 2].map((n) => (
            <div key={n} className="rounded-2xl p-6" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
              <div className="flex gap-3">
                <div className="skeleton w-11 h-11 rounded-xl" />
                <div className="space-y-2 flex-1">
                  <div className="skeleton h-4 w-32" />
                  <div className="skeleton h-3 w-56" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : feeds.length === 0 ? (
        <div
          className="rounded-2xl p-16 text-center"
          style={{ background: 'var(--bg-card)', backdropFilter: 'blur(16px)', border: '1px solid var(--border)' }}
        >
          <div className="w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-5" style={{ background: 'var(--bg-elevated)' }}>
            <Rss size={32} style={{ color: 'var(--text-muted)' }} />
          </div>
          <p className="text-base font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>暂无 RSS 订阅</p>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>点击「添加 RSS」开始自动订阅</p>
        </div>
      ) : (
        <div className="space-y-3">
          {feeds.map((feed: any) => (
            <div
              key={feed.id}
              className="group rounded-2xl p-5 transition-all duration-300 hover:translate-y-[-1px]"
              style={{
                background: 'var(--bg-card)',
                backdropFilter: 'blur(16px)',
                border: '1px solid var(--border)',
                boxShadow: '0 2px 16px rgba(0,0,0,0.1)',
                animation: 'slideUp 0.4s ease-out both',
              }}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div
                    className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 transition-all duration-300"
                    style={{
                      background: feed.enabled
                        ? 'linear-gradient(135deg, rgba(99,102,241,0.15), rgba(99,102,241,0.05))'
                        : 'linear-gradient(135deg, rgba(113,113,122,0.15), rgba(113,113,122,0.05))',
                      border: `1px solid ${feed.enabled ? 'rgba(99,102,241,0.2)' : 'rgba(113,113,122,0.2)'}`,
                    }}
                  >
                    <Rss size={18} style={{ color: feed.enabled ? 'var(--accent)' : 'var(--text-muted)' }} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{feed.name}</h3>
                      <span
                        className="px-2 py-0.5 rounded-md text-[10px] font-semibold shrink-0"
                        style={{
                          background: feed.enabled ? 'rgba(34,197,94,0.1)' : 'rgba(113,113,122,0.15)',
                          color: feed.enabled ? 'var(--success)' : 'var(--text-muted)',
                        }}
                      >
                        {feed.enabled ? '启用' : '禁用'}
                      </span>
                    </div>
                    <p className="text-xs mt-0.5 truncate font-mono" style={{ color: 'var(--text-muted)' }}>{feed.url}</p>
                  </div>
                </div>

                <div className="flex gap-1.5 ml-3 opacity-60 group-hover:opacity-100 transition-opacity duration-200">
                  <button onClick={() => handleEdit(feed)}
                    className="p-2 rounded-lg cursor-pointer transition-all duration-200"
                    style={{ color: 'var(--text-secondary)', background: 'var(--bg-elevated)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.background = 'var(--bg-hover)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.background = 'var(--bg-elevated)' }}
                  >
                    <Pencil size={14} />
                  </button>
                  <button onClick={() => setDeleteConfirm(feed.id)}
                    className="p-2 rounded-lg cursor-pointer transition-all duration-200"
                    style={{ color: 'var(--danger)', background: 'var(--bg-elevated)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(239,68,68,0.12)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-elevated)' }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              {/* Meta chips */}
              <div className="flex flex-wrap gap-2 mt-3 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium"
                  style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
                  <Power size={10} /> {instanceName(feed.instance_id)}
                </span>
                {feed.download_path && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium"
                    style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
                    <FolderOpen size={10} /> {feed.download_path}
                  </span>
                )}
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium"
                  style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
                  <Clock size={10} /> {feed.refresh_interval || 5} min
                </span>
                {feed.include_filter && (
                  <span className="px-2.5 py-1 rounded-lg text-[11px] font-medium"
                    style={{ background: 'rgba(34,197,94,0.1)', color: 'var(--success)' }}>
                    + {feed.include_filter}
                  </span>
                )}
                {feed.exclude_filter && (
                  <span className="px-2.5 py-1 rounded-lg text-[11px] font-medium"
                    style={{ background: 'rgba(239,68,68,0.1)', color: 'var(--danger)' }}>
                    - {feed.exclude_filter}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Delete Confirmation */}
      {deleteConfirm !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ animation: 'fadeIn 0.15s ease-out' }}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setDeleteConfirm(null)} />
          <div className="relative rounded-2xl p-6 w-full max-w-sm mx-4"
            style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', boxShadow: '0 24px 64px rgba(0,0,0,0.5)', animation: 'slideUp 0.2s ease-out' }}>
            <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: 'rgba(239,68,68,0.1)' }}>
              <Trash2 size={20} style={{ color: 'var(--danger)' }} />
            </div>
            <h3 className="text-center text-base font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>确认删除</h3>
            <p className="text-center text-sm mb-6" style={{ color: 'var(--text-muted)' }}>确定要删除此 RSS 订阅吗？</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteConfirm(null)}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium cursor-pointer"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                取消
              </button>
              <button onClick={() => deleteMutation.mutate(deleteConfirm)}
                disabled={deleteMutation.isPending}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white cursor-pointer disabled:opacity-50"
                style={{ background: 'var(--danger)', boxShadow: '0 4px 16px rgba(239,68,68,0.3)' }}>
                {deleteMutation.isPending ? '删除中...' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
