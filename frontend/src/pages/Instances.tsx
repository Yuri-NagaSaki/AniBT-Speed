import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { instancesApi } from '../api/client'
import { Plus, Trash2, TestTube, Pencil, X, Server, Upload, Download, Loader2, CheckCircle2, XCircle } from 'lucide-react'

function formatSpeed(bytes: number): string {
  if (!bytes) return '0 B/s'
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}

export default function Instances() {
  const queryClient = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState({ name: '', url: '', username: '', password: '', download_path: '' })
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)

  const { data: instances = [], isLoading } = useQuery({
    queryKey: ['instances'],
    queryFn: instancesApi.list,
    refetchInterval: 5000,
  })

  const createMutation = useMutation({
    mutationFn: instancesApi.create,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['instances'] }); resetForm() },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: typeof form }) => instancesApi.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['instances'] }); resetForm() },
  })

  const deleteMutation = useMutation({
    mutationFn: instancesApi.delete,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['instances'] }); setDeleteConfirm(null) },
  })

  const [testResult, setTestResult] = useState<any>(null)
  const [testingId, setTestingId] = useState<number | null>(null)
  const testMutation = useMutation({
    mutationFn: instancesApi.test,
    onSuccess: (data) => {
      setTestResult(data)
      setTestingId(null)
      setTimeout(() => setTestResult(null), 4000)
    },
    onError: (err: any) => {
      setTestResult({ success: false, error: err.message })
      setTestingId(null)
      setTimeout(() => setTestResult(null), 4000)
    },
  })

  function resetForm() {
    setForm({ name: '', url: '', username: '', password: '', download_path: '' })
    setShowForm(false)
    setEditId(null)
  }

  function handleEdit(inst: any) {
    setForm({ name: inst.name, url: inst.url, username: inst.username, password: '', download_path: inst.download_path || '' })
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

  function handleTest(id: number) {
    setTestingId(id)
    testMutation.mutate(id)
  }

  const inputStyle = {
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    color: 'var(--text-primary)',
  }

  return (
    <div className="max-w-5xl mx-auto" style={{ animation: 'fadeIn 0.4s ease-out' }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
            实例管理
          </h1>
          <p className="text-sm mt-1.5 font-medium" style={{ color: 'var(--text-secondary)' }}>
            管理 qBittorrent 实例连接
          </p>
        </div>
        <button
          onClick={() => { resetForm(); setShowForm(true) }}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white cursor-pointer transition-all duration-300"
          style={{
            background: 'var(--gradient-accent)',
            boxShadow: '0 4px 20px var(--accent-glow)',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 6px 28px var(--accent-glow)' }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 4px 20px var(--accent-glow)' }}
        >
          <Plus size={16} /> 添加实例
        </button>
      </div>

      {/* Add/Edit Form Modal Overlay */}
      {showForm && (
        <div className="fixed inset-0 z-40 flex items-center justify-center" style={{ animation: 'fadeIn 0.2s ease-out' }}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={resetForm} />
          <div
            className="relative w-full max-w-xl mx-4 rounded-2xl p-6"
            style={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border)',
              boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
              animation: 'slideUp 0.3s ease-out',
            }}
          >
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center"
                  style={{ background: 'var(--gradient-subtle)', border: '1px solid rgba(99,102,241,0.2)' }}
                >
                  <Server size={16} style={{ color: 'var(--accent)' }} />
                </div>
                <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {editId ? '编辑实例' : '添加新实例'}
                </h3>
              </div>
              <button onClick={resetForm} className="p-2 rounded-lg cursor-pointer transition-colors duration-200 hover:bg-[var(--bg-hover)]" style={{ color: 'var(--text-muted)' }}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {[
                  { key: 'name', label: '名称', placeholder: '例如: 主服务器' },
                  { key: 'url', label: 'WebUI 地址', placeholder: 'http://localhost:8181' },
                  { key: 'username', label: '用户名', placeholder: 'admin' },
                  { key: 'password', label: '密码', placeholder: '••••••', type: 'password' },
                ].map(({ key, label, placeholder, type }) => (
                  <label key={key} className="block">
                    <span className="text-xs font-semibold mb-2 block tracking-wide" style={{ color: 'var(--text-secondary)' }}>{label}</span>
                    <input
                      type={type || 'text'}
                      value={(form as any)[key]}
                      onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                      placeholder={placeholder}
                      className="w-full px-4 py-2.5 rounded-xl text-sm outline-none transition-all duration-200"
                      style={inputStyle}
                      onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.boxShadow = '0 0 0 3px var(--accent-glow)' }}
                      onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.boxShadow = 'none' }}
                    />
                  </label>
                ))}
              </div>
              <label className="block">
                <span className="text-xs font-semibold mb-2 block tracking-wide" style={{ color: 'var(--text-secondary)' }}>下载目录</span>
                <input
                  value={form.download_path}
                  onChange={(e) => setForm({ ...form, download_path: e.target.value })}
                  placeholder="/root/AniBt"
                  className="w-full px-4 py-2.5 rounded-xl text-sm outline-none transition-all duration-200"
                  style={inputStyle}
                  onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.boxShadow = '0 0 0 3px var(--accent-glow)' }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.boxShadow = 'none' }}
                />
              </label>

              <div className="flex gap-3 justify-end pt-2">
                <button
                  type="button"
                  onClick={resetForm}
                  className="px-4 py-2.5 rounded-xl text-sm font-medium cursor-pointer transition-all duration-200"
                  style={{ color: 'var(--text-secondary)', background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending}
                  className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white cursor-pointer transition-all duration-300 disabled:opacity-50"
                  style={{ background: 'var(--gradient-accent)', boxShadow: '0 4px 16px var(--accent-glow)' }}
                >
                  {(createMutation.isPending || updateMutation.isPending) ? '保存中...' : editId ? '保存修改' : '添加实例'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Instances Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2].map((n) => (
            <div key={n} className="rounded-2xl p-6 h-48" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
              <div className="flex gap-3 mb-6">
                <div className="skeleton w-11 h-11 rounded-xl" />
                <div className="space-y-2 flex-1">
                  <div className="skeleton h-4 w-24" />
                  <div className="skeleton h-3 w-40" />
                </div>
              </div>
              <div className="grid grid-cols-4 gap-3">
                {[1, 2, 3, 4].map((m) => <div key={m} className="skeleton h-12 rounded-lg" />)}
              </div>
            </div>
          ))}
        </div>
      ) : instances.length === 0 ? (
        <div
          className="rounded-2xl p-16 text-center"
          style={{ background: 'var(--bg-card)', backdropFilter: 'blur(16px)', border: '1px solid var(--border)' }}
        >
          <div className="w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-5" style={{ background: 'var(--bg-elevated)' }}>
            <Server size={32} style={{ color: 'var(--text-muted)' }} />
          </div>
          <p className="text-base font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>暂无实例</p>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>点击「添加实例」开始管理 qBittorrent</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {instances.map((inst: any) => (
            <div
              key={inst.id}
              className="group rounded-2xl p-6 transition-all duration-300 hover:translate-y-[-2px]"
              style={{
                background: 'var(--bg-card)',
                backdropFilter: 'blur(16px)',
                border: '1px solid var(--border)',
                boxShadow: '0 4px 24px rgba(0,0,0,0.15)',
                animation: 'slideUp 0.4s ease-out both',
              }}
            >
              {/* Card Header */}
              <div className="flex items-start justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div
                    className="w-11 h-11 rounded-xl flex items-center justify-center transition-all duration-300"
                    style={{
                      background: inst.status?.connected
                        ? 'linear-gradient(135deg, rgba(34,197,94,0.15), rgba(34,197,94,0.05))'
                        : 'linear-gradient(135deg, rgba(239,68,68,0.15), rgba(239,68,68,0.05))',
                      border: `1px solid ${inst.status?.connected ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`,
                    }}
                  >
                    <Server size={18} style={{ color: inst.status?.connected ? 'var(--success)' : 'var(--danger)' }} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{inst.name}</h3>
                      <div className="relative flex items-center justify-center w-3 h-3">
                        {inst.status?.connected && (
                          <div className="absolute inset-0 rounded-full animate-ping opacity-40" style={{ background: 'var(--success)' }} />
                        )}
                        <div
                          className="w-2 h-2 rounded-full relative z-10"
                          style={{
                            background: inst.status?.connected ? 'var(--success)' : 'var(--danger)',
                            boxShadow: inst.status?.connected ? '0 0 6px var(--success-glow)' : 'none',
                          }}
                        />
                      </div>
                    </div>
                    <p className="text-xs mt-0.5 font-mono" style={{ color: 'var(--text-muted)' }}>{inst.url}</p>
                  </div>
                </div>

                {/* Action buttons */}
                <div className="flex gap-1.5 opacity-60 group-hover:opacity-100 transition-opacity duration-200">
                  <button
                    onClick={() => handleTest(inst.id)}
                    disabled={testingId === inst.id}
                    className="p-2 rounded-lg cursor-pointer transition-all duration-200"
                    style={{ color: 'var(--accent)', background: 'var(--bg-elevated)' }}
                    title="测试连接"
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(99,102,241,0.15)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-elevated)' }}
                  >
                    {testingId === inst.id ? <Loader2 size={14} className="animate-spin" /> : <TestTube size={14} />}
                  </button>
                  <button
                    onClick={() => handleEdit(inst)}
                    className="p-2 rounded-lg cursor-pointer transition-all duration-200"
                    style={{ color: 'var(--text-secondary)', background: 'var(--bg-elevated)' }}
                    title="编辑"
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text-primary)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-elevated)'; e.currentTarget.style.color = 'var(--text-secondary)' }}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => setDeleteConfirm(inst.id)}
                    className="p-2 rounded-lg cursor-pointer transition-all duration-200"
                    style={{ color: 'var(--danger)', background: 'var(--bg-elevated)' }}
                    title="删除"
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(239,68,68,0.12)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-elevated)' }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              {/* Stats */}
              {inst.status?.connected && (
                <div className="grid grid-cols-4 gap-3">
                  {[
                    { label: '上传', value: formatSpeed(inst.status.up_speed || 0), icon: <Upload size={11} />, color: 'var(--success)' },
                    { label: '下载', value: formatSpeed(inst.status.dl_speed || 0), icon: <Download size={11} />, color: 'var(--accent)' },
                    { label: '种子', value: inst.status.total || 0, color: 'var(--text-secondary)' },
                    { label: '活跃', value: inst.status.active || 0, color: 'var(--warning)' },
                  ].map(({ label, value, icon, color }) => (
                    <div
                      key={label}
                      className="rounded-xl px-3 py-2.5 text-center"
                      style={{ background: 'rgba(9,9,11,0.5)', border: '1px solid var(--border)' }}
                    >
                      <p className="text-[10px] font-semibold tracking-wider uppercase mb-1" style={{ color: 'var(--text-muted)' }}>
                        {icon && <span className="inline-flex mr-0.5" style={{ color }}>{icon}</span>}
                        {label}
                      </p>
                      <p className="text-sm font-bold" style={{ color }}>{value}</p>
                    </div>
                  ))}
                </div>
              )}

              {!inst.status?.connected && (
                <div
                  className="rounded-xl px-4 py-3 flex items-center gap-2"
                  style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)' }}
                >
                  <XCircle size={14} style={{ color: 'var(--danger)' }} />
                  <span className="text-xs font-medium" style={{ color: 'var(--danger)' }}>无法连接到实例</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ animation: 'fadeIn 0.15s ease-out' }}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setDeleteConfirm(null)} />
          <div
            className="relative rounded-2xl p-6 w-full max-w-sm mx-4"
            style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', boxShadow: '0 24px 64px rgba(0,0,0,0.5)', animation: 'slideUp 0.2s ease-out' }}
          >
            <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: 'rgba(239,68,68,0.1)' }}>
              <Trash2 size={20} style={{ color: 'var(--danger)' }} />
            </div>
            <h3 className="text-center text-base font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>确认删除</h3>
            <p className="text-center text-sm mb-6" style={{ color: 'var(--text-muted)' }}>此操作无法撤销，确定要删除此实例吗？</p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium cursor-pointer transition-all duration-200"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
              >
                取消
              </button>
              <button
                onClick={() => deleteMutation.mutate(deleteConfirm)}
                disabled={deleteMutation.isPending}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white cursor-pointer transition-all duration-200 disabled:opacity-50"
                style={{ background: 'var(--danger)', boxShadow: '0 4px 16px rgba(239,68,68,0.3)' }}
              >
                {deleteMutation.isPending ? '删除中...' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Test Result Toast */}
      {testResult && (
        <div
          className="fixed bottom-6 right-6 flex items-center gap-3 px-5 py-3.5 rounded-xl text-sm font-semibold shadow-2xl z-50 cursor-pointer"
          style={{
            background: testResult.success ? 'var(--success)' : 'var(--danger)',
            color: 'white',
            boxShadow: testResult.success ? '0 8px 32px rgba(34,197,94,0.3)' : '0 8px 32px rgba(239,68,68,0.3)',
            animation: 'slideUp 0.3s ease-out',
          }}
          onClick={() => setTestResult(null)}
        >
          {testResult.success ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
          {testResult.success ? `连接成功 (v${testResult.version})` : `连接失败: ${testResult.error}`}
        </div>
      )}
    </div>
  )
}
