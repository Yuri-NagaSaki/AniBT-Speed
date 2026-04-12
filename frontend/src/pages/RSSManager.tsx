import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { rssApi, instancesApi } from '../api/client'
import { Plus, Trash2, Pencil, X, FolderOpen, Clock, Power, Tag } from 'lucide-react'

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '12px 16px',
  borderRadius: 10,
  fontSize: 14,
  background: 'var(--ctp-mantle)',
  border: '1px solid var(--ctp-surface1)',
  color: 'var(--ctp-text)',
  outline: 'none',
  fontFamily: 'inherit',
  transition: 'border-color 0.15s ease',
}

export default function RSSManager() {
  const queryClient = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState({
    name: '', url: '', instance_id: 0, download_path: '', tag: '',
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
    setForm({ name: '', url: '', instance_id: instances[0]?.id || 0, download_path: '', tag: '', include_filter: '', exclude_filter: '', refresh_interval: 5, enabled: true })
    setShowForm(false)
    setEditId(null)
  }

  function handleEdit(feed: any) {
    setForm({
      name: feed.name, url: feed.url, instance_id: feed.instance_id,
      download_path: feed.download_path || '', tag: feed.tag || '', include_filter: feed.include_filter || '',
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

  const instanceName = (id: number) => id === 0 ? '自动分配' : (instances.find((i: any) => i.id === id)?.name || `#${id}`)

  return (
    <div style={{ animation: 'fadeIn 0.3s ease-out' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 48 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, color: 'var(--ctp-text)', letterSpacing: '-0.02em', lineHeight: 1.3 }}>
            RSS 管理
          </h1>
          <p style={{ fontSize: 14, color: 'var(--ctp-subtext0)', marginTop: 8, lineHeight: 1.6 }}>
            管理 RSS 订阅源和自动下载规则
          </p>
        </div>
        <button
          onClick={() => { resetForm(); setShowForm(true) }}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '12px 24px', borderRadius: 10, border: 'none', cursor: 'pointer',
            fontSize: 14, fontWeight: 500, fontFamily: 'inherit',
            background: 'var(--ctp-mauve)', color: 'var(--ctp-crust)',
            transition: 'opacity 0.15s ease',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.9' }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = '1' }}
        >
          <Plus size={16} /> 添加 RSS 源
        </button>
      </div>

      {/* Add/Edit Form — slide-down panel */}
      {showForm && (
        <div style={{
          marginBottom: 32,
          background: 'var(--ctp-surface0)',
          border: '1px solid var(--ctp-surface1)',
          borderRadius: 14,
          padding: 32,
          animation: 'slideUp 0.2s ease-out',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
            <h3 style={{ fontSize: 18, fontWeight: 600, color: 'var(--ctp-text)' }}>
              {editId ? '编辑 RSS 源' : '添加 RSS 源'}
            </h3>
            <button onClick={resetForm} style={{
              padding: 6, borderRadius: 8, border: 'none', cursor: 'pointer',
              background: 'none', color: 'var(--ctp-overlay1)', transition: 'color 0.15s ease',
            }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--ctp-text)' }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--ctp-overlay1)' }}>
              <X size={18} />
            </button>
          </div>

          <form onSubmit={handleSubmit}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--ctp-subtext0)', marginBottom: 10 }}>名称</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Anibt"
                  style={inputStyle}
                  onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--ctp-mauve)' }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--ctp-surface1)' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--ctp-subtext0)', marginBottom: 10 }}>RSS URL</label>
                <input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://example.com/rss.xml"
                  style={inputStyle}
                  onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--ctp-mauve)' }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--ctp-surface1)' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--ctp-subtext0)', marginBottom: 10 }}>目标实例</label>
                <select value={form.instance_id} onChange={(e) => setForm({ ...form, instance_id: Number(e.target.value) })}
                  style={inputStyle}>
                  <option value={0}>自动（负载均衡）</option>
                  {instances.map((i: any) => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--ctp-subtext0)', marginBottom: 10 }}>下载目录</label>
                <input value={form.download_path} onChange={(e) => setForm({ ...form, download_path: e.target.value })} placeholder="/AniBt"
                  style={inputStyle}
                  onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--ctp-mauve)' }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--ctp-surface1)' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--ctp-subtext0)', marginBottom: 10 }}>自动标签</label>
                <input value={form.tag} onChange={(e) => setForm({ ...form, tag: e.target.value })} placeholder="如 anibt"
                  style={inputStyle}
                  onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--ctp-mauve)' }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--ctp-surface1)' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--ctp-subtext0)', marginBottom: 10 }}>包含关键字</label>
                <input value={form.include_filter} onChange={(e) => setForm({ ...form, include_filter: e.target.value })} placeholder="留空表示全部"
                  style={inputStyle}
                  onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--ctp-mauve)' }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--ctp-surface1)' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--ctp-subtext0)', marginBottom: 10 }}>排除关键字</label>
                <input value={form.exclude_filter} onChange={(e) => setForm({ ...form, exclude_filter: e.target.value })} placeholder="DBD|搬运"
                  style={inputStyle}
                  onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--ctp-mauve)' }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--ctp-surface1)' }} />
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <button type="button" onClick={() => setForm({ ...form, enabled: !form.enabled })}
                  style={{
                    position: 'relative', width: 44, height: 24,
                    borderRadius: 12, border: 'none', cursor: 'pointer',
                    background: form.enabled ? 'var(--ctp-mauve)' : 'var(--ctp-surface2)',
                    transition: 'background 0.2s ease',
                  }}>
                  <div style={{
                    position: 'absolute', top: 2,
                    left: form.enabled ? 22 : 2,
                    width: 20, height: 20, borderRadius: 10,
                    background: form.enabled ? 'var(--ctp-crust)' : 'var(--ctp-overlay0)',
                    transition: 'all 0.2s ease',
                  }} />
                </button>
                <span style={{ fontSize: 14, color: 'var(--ctp-text)' }}>
                  {form.enabled ? '已启用' : '已禁用'}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 16 }}>
                <button type="button" onClick={resetForm}
                  style={{
                    padding: '12px 24px', borderRadius: 10, cursor: 'pointer',
                    fontSize: 14, fontWeight: 500, fontFamily: 'inherit',
                    background: 'transparent', color: 'var(--ctp-subtext0)',
                    border: '1px solid var(--ctp-surface1)',
                    transition: 'color 0.15s ease',
                  }}>
                  取消
                </button>
                <button type="submit" disabled={createMutation.isPending || updateMutation.isPending}
                  style={{
                    padding: '12px 24px', borderRadius: 10, cursor: 'pointer',
                    fontSize: 14, fontWeight: 500, fontFamily: 'inherit',
                    background: 'var(--ctp-mauve)', color: 'var(--ctp-crust)', border: 'none',
                    opacity: (createMutation.isPending || updateMutation.isPending) ? 0.5 : 1,
                    transition: 'opacity 0.15s ease',
                  }}>
                  {editId ? '保存修改' : '添加源'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* Feed List */}
      {isLoading ? (
        <div>
          {[1, 2].map((n) => (
            <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '20px 0' }}>
              <div style={{ height: 14, width: 112, borderRadius: 4, background: 'var(--ctp-surface1)' }} />
              <div style={{ height: 12, width: 192, borderRadius: 4, background: 'var(--ctp-surface1)' }} />
            </div>
          ))}
        </div>
      ) : feeds.length === 0 ? (
        <div style={{ padding: '64px 0', textAlign: 'center' as const }}>
          <p style={{ fontSize: 14, color: 'var(--ctp-overlay1)' }}>暂无 RSS 订阅</p>
          <p style={{ fontSize: 12, color: 'var(--ctp-overlay0)', marginTop: 8 }}>点击「添加 RSS 源」开始自动订阅</p>
        </div>
      ) : (
        <div style={{
          background: 'var(--ctp-surface0)', border: '1px solid var(--ctp-surface1)',
          borderRadius: 14, overflow: 'hidden',
        }}>
          {feeds.map((feed: any, idx: number) => (
            <div key={feed.id} style={{
              padding: '20px 24px',
              borderBottom: idx < feeds.length - 1 ? '1px solid var(--ctp-surface1)' : 'none',
              transition: 'background 0.15s ease',
            }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(69,71,90,0.3)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <h3 style={{ fontSize: 14, fontWeight: 500, color: 'var(--ctp-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{feed.name}</h3>
                    <span style={{ fontSize: 12, flexShrink: 0, color: feed.enabled ? 'var(--ctp-green)' : 'var(--ctp-overlay0)' }}>
                      {feed.enabled ? '启用' : '禁用'}
                    </span>
                  </div>
                  <p style={{ fontSize: 12, color: 'var(--ctp-overlay1)', marginTop: 4, fontFamily: '"Geist Mono", monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{feed.url}</p>
                </div>
                <div style={{ display: 'flex', gap: 4, marginLeft: 16 }}>
                  <button onClick={() => handleEdit(feed)}
                    style={{ padding: 8, borderRadius: 8, border: 'none', cursor: 'pointer', background: 'none', color: 'var(--ctp-overlay1)', transition: 'color 0.15s ease' }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--ctp-text)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--ctp-overlay1)' }}>
                    <Pencil size={15} />
                  </button>
                  <button onClick={() => setDeleteConfirm(feed.id)}
                    style={{ padding: 8, borderRadius: 8, border: 'none', cursor: 'pointer', background: 'none', color: 'var(--ctp-overlay1)', transition: 'color 0.15s ease' }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--ctp-red)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--ctp-overlay1)' }}>
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 12, marginTop: 12, fontSize: 12, color: 'var(--ctp-overlay1)' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <Power size={11} /> {instanceName(feed.instance_id)}
                </span>
                {feed.download_path && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <FolderOpen size={11} /> {feed.download_path}
                  </span>
                )}
                {feed.tag && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--ctp-mauve)' }}>
                    <Tag size={11} /> {feed.tag}
                  </span>
                )}
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <Clock size={11} /> {feed.refresh_interval || 5} min
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
        <div style={{
          position: 'fixed', inset: 0, zIndex: 50,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          animation: 'fadeIn 0.15s ease-out',
        }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(17,17,27,0.7)' }} onClick={() => setDeleteConfirm(null)} />
          <div style={{
            position: 'relative', width: '100%', maxWidth: 400, margin: '0 16px',
            background: 'var(--ctp-surface0)', border: '1px solid var(--ctp-surface1)',
            borderRadius: 16, padding: 40, animation: 'slideUp 0.2s ease-out',
          }}>
            <h3 style={{ fontSize: 18, fontWeight: 600, color: 'var(--ctp-text)', marginBottom: 12 }}>确认删除</h3>
            <p style={{ fontSize: 14, color: 'var(--ctp-overlay1)', marginBottom: 32, lineHeight: 1.6 }}>确定要删除此 RSS 订阅吗？</p>
            <div style={{ display: 'flex', gap: 16, justifyContent: 'flex-end' }}>
              <button onClick={() => setDeleteConfirm(null)}
                style={{
                  padding: '12px 24px', borderRadius: 10, cursor: 'pointer',
                  fontSize: 14, fontWeight: 500, fontFamily: 'inherit',
                  background: 'transparent', color: 'var(--ctp-subtext0)',
                  border: '1px solid var(--ctp-surface1)',
                  transition: 'color 0.15s ease',
                }}>
                取消
              </button>
              <button onClick={() => deleteMutation.mutate(deleteConfirm)} disabled={deleteMutation.isPending}
                style={{
                  padding: '12px 24px', borderRadius: 10, cursor: 'pointer',
                  fontSize: 14, fontWeight: 500, fontFamily: 'inherit',
                  background: 'transparent', color: 'var(--ctp-red)',
                  border: '1px solid var(--ctp-red)',
                  opacity: deleteMutation.isPending ? 0.5 : 1,
                  transition: 'opacity 0.15s ease',
                }}>
                {deleteMutation.isPending ? '删除中...' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
