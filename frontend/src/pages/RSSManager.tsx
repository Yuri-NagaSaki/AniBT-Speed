import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { rssApi, instancesApi } from '../api/client'
import { Plus, Trash2, Pencil, X, FolderOpen, Clock, Power } from 'lucide-react'

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

  const inputStyle: React.CSSProperties = {
    padding: '10px 14px',
    borderRadius: '8px',
    fontSize: '13px',
    background: 'var(--ctp-surface0)',
    border: '1px solid var(--ctp-surface1)',
    color: 'var(--ctp-text)',
  }

  const instanceName = (id: number) => instances.find((i: any) => i.id === id)?.name || `#${id}`

  return (
    <div className="max-w-5xl mx-auto" style={{ animation: 'fadeIn 0.3s ease-out' }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-12">
        <div>
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--ctp-text)' }}>RSS 管理</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--ctp-subtext0)' }}>管理 RSS 订阅源和自动下载规则</p>
        </div>
        <button
          onClick={() => { resetForm(); setShowForm(true) }}
          className="flex items-center gap-2 cursor-pointer transition-opacity duration-150"
          style={{
            padding: '8px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 500,
            background: 'var(--ctp-mauve)', color: 'var(--ctp-crust)', border: 'none',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.9' }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = '1' }}
        >
          <Plus size={14} /> 添加 RSS 源
        </button>
      </div>

      {/* Add/Edit Form — slide-down panel */}
      {showForm && (
        <div
          className="mb-6"
          style={{
            background: 'var(--ctp-surface0)',
            border: '1px solid var(--ctp-surface1)',
            borderRadius: '12px',
            padding: '24px',
            animation: 'slideUp 0.2s ease-out',
          }}
        >
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-base font-semibold" style={{ color: 'var(--ctp-text)' }}>
              {editId ? '编辑 RSS 源' : '添加 RSS 源'}
            </h3>
            <button onClick={resetForm} className="p-1.5 rounded-md cursor-pointer transition-colors duration-150"
              style={{ color: 'var(--ctp-overlay1)' }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--ctp-text)' }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--ctp-overlay1)' }}>
              <X size={16} />
            </button>
          </div>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block">
              <span className="text-xs font-medium mb-1.5 block" style={{ color: 'var(--ctp-subtext0)' }}>名称</span>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Anibt"
                className="w-full outline-none transition-colors duration-150" style={inputStyle}
                onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--ctp-mauve)' }}
                onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--ctp-surface1)' }} />
            </label>
            <label className="block">
              <span className="text-xs font-medium mb-1.5 block" style={{ color: 'var(--ctp-subtext0)' }}>RSS URL</span>
              <input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://example.com/rss.xml"
                className="w-full outline-none transition-colors duration-150" style={inputStyle}
                onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--ctp-mauve)' }}
                onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--ctp-surface1)' }} />
            </label>
            <label className="block">
              <span className="text-xs font-medium mb-1.5 block" style={{ color: 'var(--ctp-subtext0)' }}>绑定实例</span>
              <select value={form.instance_id} onChange={(e) => setForm({ ...form, instance_id: Number(e.target.value) })}
                className="w-full outline-none transition-colors duration-150" style={inputStyle}>
                <option value={0}>选择实例</option>
                {instances.map((i: any) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium mb-1.5 block" style={{ color: 'var(--ctp-subtext0)' }}>下载目录</span>
              <input value={form.download_path} onChange={(e) => setForm({ ...form, download_path: e.target.value })} placeholder="/AniBt"
                className="w-full outline-none transition-colors duration-150" style={inputStyle}
                onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--ctp-mauve)' }}
                onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--ctp-surface1)' }} />
            </label>
            <label className="block">
              <span className="text-xs font-medium mb-1.5 block" style={{ color: 'var(--ctp-subtext0)' }}>包含关键字</span>
              <input value={form.include_filter} onChange={(e) => setForm({ ...form, include_filter: e.target.value })} placeholder="留空表示全部"
                className="w-full outline-none transition-colors duration-150" style={inputStyle}
                onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--ctp-mauve)' }}
                onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--ctp-surface1)' }} />
            </label>
            <label className="block">
              <span className="text-xs font-medium mb-1.5 block" style={{ color: 'var(--ctp-subtext0)' }}>排除关键字</span>
              <input value={form.exclude_filter} onChange={(e) => setForm({ ...form, exclude_filter: e.target.value })} placeholder="DBD|搬运"
                className="w-full outline-none transition-colors duration-150" style={inputStyle}
                onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--ctp-mauve)' }}
                onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--ctp-surface1)' }} />
            </label>
            <div className="sm:col-span-2 flex items-center justify-between pt-2">
              <label className="flex items-center gap-3">
                <button type="button" onClick={() => setForm({ ...form, enabled: !form.enabled })}
                  className="relative w-11 h-6 rounded-full transition-colors duration-150 cursor-pointer"
                  style={{ background: form.enabled ? 'var(--ctp-mauve)' : 'var(--ctp-surface2)' }}>
                  <div className="absolute top-[2px] w-5 h-5 rounded-full bg-white transition-all duration-150"
                    style={{ left: form.enabled ? '22px' : '2px', background: form.enabled ? 'var(--ctp-crust)' : 'var(--ctp-overlay0)' }} />
                </button>
                <span className="text-sm" style={{ color: 'var(--ctp-text)' }}>
                  {form.enabled ? '已启用' : '已禁用'}
                </span>
              </label>
              <div className="flex gap-3">
                <button type="button" onClick={resetForm} className="cursor-pointer transition-colors duration-150"
                  style={{ padding: '8px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 500,
                    background: 'transparent', color: 'var(--ctp-subtext0)', border: '1px solid var(--ctp-surface1)' }}>
                  取消
                </button>
                <button type="submit" disabled={createMutation.isPending || updateMutation.isPending}
                  className="cursor-pointer transition-opacity duration-150 disabled:opacity-50"
                  style={{ padding: '8px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 500,
                    background: 'var(--ctp-mauve)', color: 'var(--ctp-crust)', border: 'none' }}>
                  {editId ? '保存修改' : '添加源'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* Feed List */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2].map((n) => (
            <div key={n} className="py-4 flex items-center gap-3">
              <div className="h-3 w-28 rounded" style={{ background: 'var(--ctp-surface1)' }} />
              <div className="h-2.5 w-48 rounded" style={{ background: 'var(--ctp-surface1)' }} />
            </div>
          ))}
        </div>
      ) : feeds.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-sm" style={{ color: 'var(--ctp-overlay1)' }}>暂无 RSS 订阅</p>
          <p className="text-xs mt-1" style={{ color: 'var(--ctp-overlay0)' }}>点击「添加 RSS 源」开始自动订阅</p>
        </div>
      ) : (
        <div style={{
          background: 'var(--ctp-surface0)', border: '1px solid var(--ctp-surface1)',
          borderRadius: '12px', overflow: 'hidden',
        }}>
          {feeds.map((feed: any, idx: number) => (
            <div key={feed.id}
              className="px-6 py-4 transition-colors duration-150"
              style={{ borderBottom: idx < feeds.length - 1 ? '1px solid var(--ctp-surface0)' : 'none' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--ctp-surface0)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-medium truncate" style={{ color: 'var(--ctp-text)' }}>{feed.name}</h3>
                      <span className="text-xs shrink-0" style={{ color: feed.enabled ? 'var(--ctp-green)' : 'var(--ctp-overlay0)' }}>
                        {feed.enabled ? '启用' : '禁用'}
                      </span>
                    </div>
                    <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--ctp-overlay1)', fontFamily: '"Geist Mono", monospace' }}>{feed.url}</p>
                  </div>
                </div>
                <div className="flex gap-1 ml-3">
                  <button onClick={() => handleEdit(feed)}
                    className="p-1.5 rounded-md cursor-pointer transition-colors duration-150"
                    style={{ color: 'var(--ctp-overlay1)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--ctp-text)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--ctp-overlay1)' }}>
                    <Pencil size={14} />
                  </button>
                  <button onClick={() => setDeleteConfirm(feed.id)}
                    className="p-1.5 rounded-md cursor-pointer transition-colors duration-150"
                    style={{ color: 'var(--ctp-overlay1)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--ctp-red)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--ctp-overlay1)' }}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap gap-3 mt-2 text-[11px]" style={{ color: 'var(--ctp-overlay1)' }}>
                <span className="inline-flex items-center gap-1">
                  <Power size={10} /> {instanceName(feed.instance_id)}
                </span>
                {feed.download_path && (
                  <span className="inline-flex items-center gap-1">
                    <FolderOpen size={10} /> {feed.download_path}
                  </span>
                )}
                <span className="inline-flex items-center gap-1">
                  <Clock size={10} /> {feed.refresh_interval || 5} min
                </span>
                {feed.include_filter && (
                  <span style={{ color: 'var(--ctp-green)' }}>+ {feed.include_filter}</span>
                )}
                {feed.exclude_filter && (
                  <span style={{ color: 'var(--ctp-red)' }}>- {feed.exclude_filter}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Delete Confirmation */}
      {deleteConfirm !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ animation: 'fadeIn 0.15s ease-out' }}>
          <div className="absolute inset-0" style={{ background: 'rgba(17,17,27,0.7)' }} onClick={() => setDeleteConfirm(null)} />
          <div className="relative w-full max-w-sm mx-4" style={{
            background: 'var(--ctp-surface0)', border: '1px solid var(--ctp-surface1)',
            borderRadius: '16px', padding: '24px', animation: 'slideUp 0.2s ease-out',
          }}>
            <h3 className="text-base font-semibold mb-2" style={{ color: 'var(--ctp-text)' }}>确认删除</h3>
            <p className="text-sm mb-6" style={{ color: 'var(--ctp-overlay1)' }}>确定要删除此 RSS 订阅吗？</p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setDeleteConfirm(null)} className="cursor-pointer transition-colors duration-150"
                style={{ padding: '8px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 500,
                  background: 'transparent', color: 'var(--ctp-subtext0)', border: '1px solid var(--ctp-surface1)' }}>
                取消
              </button>
              <button onClick={() => deleteMutation.mutate(deleteConfirm)} disabled={deleteMutation.isPending}
                className="cursor-pointer transition-colors duration-150 disabled:opacity-50"
                style={{ padding: '8px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 500,
                  background: 'transparent', color: 'var(--ctp-red)', border: '1px solid var(--ctp-red)' }}>
                {deleteMutation.isPending ? '删除中...' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
