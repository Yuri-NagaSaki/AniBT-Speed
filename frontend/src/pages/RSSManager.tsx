import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { rssApi, instancesApi } from '../api/client'
import { Plus, Trash2, Pencil, X, Rss, Power } from 'lucide-react'

export default function RSSManager() {
  const queryClient = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState({
    name: '', url: '', instance_id: 0, download_path: '',
    include_filter: '', exclude_filter: '', refresh_interval: 5, enabled: true,
  })

  const { data: feeds = [] } = useQuery({ queryKey: ['rss'], queryFn: rssApi.list })
  const { data: instances = [] } = useQuery({ queryKey: ['instances'], queryFn: instancesApi.list })

  const createMutation = useMutation({
    mutationFn: rssApi.create,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['rss'] }); resetForm() },
  })

  const deleteMutation = useMutation({
    mutationFn: rssApi.delete,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['rss'] }),
  })

  function resetForm() {
    setForm({ name: '', url: '', instance_id: instances[0]?.id || 0, download_path: '', include_filter: '', exclude_filter: '', refresh_interval: 5, enabled: true })
    setShowForm(false)
    setEditId(null)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (editId) {
      rssApi.update(editId, form).then(() => { queryClient.invalidateQueries({ queryKey: ['rss'] }); resetForm() })
    } else {
      createMutation.mutate(form)
    }
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>RSS 管理</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>管理 RSS 订阅源和自动下载规则</p>
        </div>
        <button onClick={() => { resetForm(); setShowForm(true) }}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium text-white cursor-pointer"
          style={{ background: 'var(--accent)' }}>
          <Plus size={16} /> 添加 RSS
        </button>
      </div>

      {showForm && (
        <div className="rounded-2xl p-6 mb-6" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{editId ? '编辑 RSS' : '添加 RSS 源'}</h3>
            <button onClick={resetForm} className="cursor-pointer" style={{ color: 'var(--text-muted)' }}><X size={18} /></button>
          </div>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block">
              <span className="text-xs font-medium mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>名称</span>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Anibt"
                className="w-full px-3.5 py-2.5 rounded-lg text-sm outline-none"
                style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
            </label>
            <label className="block">
              <span className="text-xs font-medium mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>RSS URL</span>
              <input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://anibt.net/rss/magnets.xml"
                className="w-full px-3.5 py-2.5 rounded-lg text-sm outline-none"
                style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
            </label>
            <label className="block">
              <span className="text-xs font-medium mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>绑定实例</span>
              <select value={form.instance_id} onChange={(e) => setForm({ ...form, instance_id: Number(e.target.value) })}
                className="w-full px-3.5 py-2.5 rounded-lg text-sm outline-none"
                style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
                <option value={0}>选择实例</option>
                {instances.map((i: any) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>下载目录</span>
              <input value={form.download_path} onChange={(e) => setForm({ ...form, download_path: e.target.value })} placeholder="/AniBt"
                className="w-full px-3.5 py-2.5 rounded-lg text-sm outline-none"
                style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
            </label>
            <label className="block">
              <span className="text-xs font-medium mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>包含关键字</span>
              <input value={form.include_filter} onChange={(e) => setForm({ ...form, include_filter: e.target.value })} placeholder="留空表示全部"
                className="w-full px-3.5 py-2.5 rounded-lg text-sm outline-none"
                style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
            </label>
            <label className="block">
              <span className="text-xs font-medium mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>排除关键字</span>
              <input value={form.exclude_filter} onChange={(e) => setForm({ ...form, exclude_filter: e.target.value })} placeholder="DBD|搬运"
                className="w-full px-3.5 py-2.5 rounded-lg text-sm outline-none"
                style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
            </label>
            <div className="sm:col-span-2 flex gap-3 justify-end mt-2">
              <button type="button" onClick={resetForm} className="px-4 py-2 rounded-lg text-sm cursor-pointer" style={{ color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>取消</button>
              <button type="submit" className="px-5 py-2 rounded-lg text-sm font-medium text-white cursor-pointer" style={{ background: 'var(--accent)' }}>{editId ? '保存' : '添加'}</button>
            </div>
          </form>
        </div>
      )}

      <div className="space-y-3">
        {feeds.length === 0 ? (
          <div className="rounded-2xl p-12 text-center" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
            <Rss size={32} className="mx-auto mb-3 opacity-40" style={{ color: 'var(--text-muted)' }} />
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>暂无 RSS 订阅</p>
          </div>
        ) : (
          feeds.map((feed: any) => (
            <div key={feed.id} className="rounded-2xl p-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                    style={{ background: feed.enabled ? 'rgba(59,130,246,0.1)' : 'rgba(100,116,139,0.1)' }}>
                    <Rss size={18} style={{ color: feed.enabled ? 'var(--accent)' : 'var(--text-muted)' }} />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{feed.name}</h3>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{feed.url}</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => { setForm(feed); setEditId(feed.id); setShowForm(true) }}
                    className="p-2 rounded-lg cursor-pointer" style={{ color: 'var(--text-secondary)', background: 'var(--bg-primary)' }}>
                    <Pencil size={14} />
                  </button>
                  <button onClick={() => { if (confirm('确认删除？')) deleteMutation.mutate(feed.id) }}
                    className="p-2 rounded-lg cursor-pointer" style={{ color: 'var(--danger)', background: 'var(--bg-primary)' }}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              <div className="flex gap-4 mt-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                <span>实例 #{feed.instance_id}</span>
                {feed.download_path && <span>📁 {feed.download_path}</span>}
                <span>⏱ {feed.refresh_interval}min</span>
                <span className="flex items-center gap-1">
                  <Power size={10} /> {feed.enabled ? '启用' : '禁用'}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
