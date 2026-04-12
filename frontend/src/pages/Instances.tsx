import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { instancesApi } from '../api/client'
import { Plus, Trash2, TestTube, Pencil, X, Server } from 'lucide-react'

export default function Instances() {
  const queryClient = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState({ name: '', url: '', username: '', password: '', download_path: '' })

  const { data: instances = [] } = useQuery({ queryKey: ['instances'], queryFn: instancesApi.list })

  const createMutation = useMutation({
    mutationFn: instancesApi.create,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['instances'] }); resetForm() },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: any) => instancesApi.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['instances'] }); resetForm() },
  })

  const deleteMutation = useMutation({
    mutationFn: instancesApi.delete,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['instances'] }),
  })

  const [testResult, setTestResult] = useState<any>(null)
  const testMutation = useMutation({
    mutationFn: instancesApi.test,
    onSuccess: (data) => setTestResult(data),
  })

  function resetForm() {
    setForm({ name: '', url: '', username: '', password: '', download_path: '' })
    setShowForm(false)
    setEditId(null)
  }

  function handleEdit(inst: any) {
    setForm({ name: inst.name, url: inst.url, username: inst.username, password: '', download_path: inst.download_path })
    setEditId(inst.id)
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

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>实例管理</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>管理 qBittorrent 实例</p>
        </div>
        <button
          onClick={() => { resetForm(); setShowForm(true) }}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium text-white transition-all cursor-pointer"
          style={{ background: 'var(--accent)' }}
          onMouseEnter={(e) => e.currentTarget.style.background = 'var(--accent-hover)'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'var(--accent)'}
        >
          <Plus size={16} /> 添加实例
        </button>
      </div>

      {/* Add/Edit Form */}
      {showForm && (
        <div className="rounded-2xl p-6 mb-6" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              {editId ? '编辑实例' : '添加新实例'}
            </h3>
            <button onClick={resetForm} className="cursor-pointer" style={{ color: 'var(--text-muted)' }}><X size={18} /></button>
          </div>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              { key: 'name', label: '名称', placeholder: '例如: 主服务器' },
              { key: 'url', label: 'WebUI 地址', placeholder: 'http://localhost:8181' },
              { key: 'username', label: '用户名', placeholder: 'admin' },
              { key: 'password', label: '密码', placeholder: '••••••', type: 'password' },
              { key: 'download_path', label: '下载目录', placeholder: '/root/AniBt', className: 'sm:col-span-2' },
            ].map(({ key, label, placeholder, type, className }) => (
              <label key={key} className={`block ${className || ''}`}>
                <span className="text-xs font-medium mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>{label}</span>
                <input
                  type={type || 'text'}
                  value={(form as any)[key]}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                  placeholder={placeholder}
                  className="w-full px-3.5 py-2.5 rounded-lg text-sm outline-none transition-colors"
                  style={{
                    background: 'var(--bg-primary)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-primary)',
                  }}
                />
              </label>
            ))}
            <div className="sm:col-span-2 flex gap-3 justify-end mt-2">
              <button type="button" onClick={resetForm}
                className="px-4 py-2 rounded-lg text-sm cursor-pointer"
                style={{ color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
                取消
              </button>
              <button type="submit"
                className="px-5 py-2 rounded-lg text-sm font-medium text-white cursor-pointer"
                style={{ background: 'var(--accent)' }}>
                {editId ? '保存' : '添加'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Instances List */}
      <div className="space-y-3">
        {instances.map((inst: any) => (
          <div key={inst.id} className="rounded-2xl p-5 transition-all"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{ background: inst.status?.connected ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)' }}>
                  <Server size={18} style={{ color: inst.status?.connected ? 'var(--success)' : 'var(--danger)' }} />
                </div>
                <div>
                  <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{inst.name}</h3>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{inst.url}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => testMutation.mutate(inst.id)}
                  className="p-2 rounded-lg transition-colors cursor-pointer"
                  style={{ color: 'var(--text-secondary)', background: 'var(--bg-primary)' }}
                  title="测试连接">
                  <TestTube size={14} />
                </button>
                <button onClick={() => handleEdit(inst)}
                  className="p-2 rounded-lg transition-colors cursor-pointer"
                  style={{ color: 'var(--text-secondary)', background: 'var(--bg-primary)' }}
                  title="编辑">
                  <Pencil size={14} />
                </button>
                <button onClick={() => { if (confirm('确认删除？')) deleteMutation.mutate(inst.id) }}
                  className="p-2 rounded-lg transition-colors cursor-pointer"
                  style={{ color: 'var(--danger)', background: 'var(--bg-primary)' }}
                  title="删除">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>

            {inst.status?.connected && (
              <div className="grid grid-cols-4 gap-4 mt-4 pt-4 border-t" style={{ borderColor: 'var(--border)' }}>
                {[
                  { label: '上传', value: `${((inst.status.up_speed || 0) / 1024 / 1024).toFixed(1)} MB/s` },
                  { label: '下载', value: `${((inst.status.dl_speed || 0) / 1024 / 1024).toFixed(1)} MB/s` },
                  { label: '种子', value: inst.status.total || 0 },
                  { label: '活跃', value: inst.status.active || 0 },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <p className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{label}</p>
                    <p className="text-lg font-semibold mt-0.5" style={{ color: 'var(--text-primary)' }}>{value}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Test Result Toast */}
      {testResult && (
        <div className="fixed bottom-6 right-6 px-5 py-3 rounded-xl text-sm font-medium shadow-xl z-50 cursor-pointer"
          style={{
            background: testResult.success ? 'var(--success)' : 'var(--danger)',
            color: 'white',
          }}
          onClick={() => setTestResult(null)}>
          {testResult.success ? `✓ 连接成功 (v${testResult.version})` : `✗ 连接失败: ${testResult.error}`}
        </div>
      )}
    </div>
  )
}
