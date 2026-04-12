import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { instancesApi } from '../api/client'
import { Plus, Trash2, TestTube, Pencil, X, Upload, Download, Loader2, CheckCircle2, XCircle } from 'lucide-react'

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
  const [formTestResult, setFormTestResult] = useState<any>(null)
  const [formTesting, setFormTesting] = useState(false)

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

  const testConnectionMutation = useMutation({
    mutationFn: instancesApi.testConnection,
    onSuccess: (data) => {
      setFormTestResult(data)
      setFormTesting(false)
      setTimeout(() => setFormTestResult(null), 5000)
    },
    onError: (err: any) => {
      setFormTestResult({ success: false, error: err.message })
      setFormTesting(false)
      setTimeout(() => setFormTestResult(null), 5000)
    },
  })

  function resetForm() {
    setForm({ name: '', url: '', username: '', password: '', download_path: '' })
    setShowForm(false)
    setEditId(null)
    setFormTestResult(null)
    setFormTesting(false)
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

  const inputStyle: React.CSSProperties = {
    padding: '10px 14px',
    borderRadius: '8px',
    fontSize: '13px',
    background: 'var(--ctp-surface0)',
    border: '1px solid var(--ctp-surface1)',
    color: 'var(--ctp-text)',
  }

  return (
    <div className="max-w-5xl mx-auto" style={{ animation: 'fadeIn 0.3s ease-out' }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-12">
        <div>
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--ctp-text)' }}>实例管理</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--ctp-subtext0)' }}>管理 qBittorrent 实例连接</p>
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
          <Plus size={14} /> 添加实例
        </button>
      </div>

      {/* Add/Edit Modal */}
      {showForm && (
        <div className="fixed inset-0 z-40 flex items-center justify-center" style={{ animation: 'fadeIn 0.15s ease-out' }}>
          <div className="absolute inset-0" style={{ background: 'rgba(17,17,27,0.7)' }} onClick={resetForm} />
          <div
            className="relative w-full max-w-xl mx-4"
            style={{
              background: 'var(--ctp-surface0)', border: '1px solid var(--ctp-surface1)',
              borderRadius: '16px', padding: '24px', animation: 'slideUp 0.2s ease-out',
            }}
          >
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-base font-semibold" style={{ color: 'var(--ctp-text)' }}>
                {editId ? '编辑实例' : '添加新实例'}
              </h3>
              <button onClick={resetForm} className="p-1.5 rounded-md cursor-pointer transition-colors duration-150"
                style={{ color: 'var(--ctp-overlay1)' }}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--ctp-text)' }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--ctp-overlay1)' }}>
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSubmit}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                {[
                  { key: 'name', label: '名称', placeholder: '例如: 主服务器' },
                  { key: 'url', label: 'WebUI 地址', placeholder: 'http://localhost:8181' },
                  { key: 'username', label: '用户名', placeholder: 'admin' },
                  { key: 'password', label: '密码', placeholder: '••••••', type: 'password' },
                ].map(({ key, label, placeholder, type }) => (
                  <label key={key} className="block">
                    <span className="text-xs font-medium mb-1.5 block" style={{ color: 'var(--ctp-subtext0)' }}>{label}</span>
                    <input type={type || 'text'} value={(form as any)[key]}
                      onChange={(e) => setForm({ ...form, [key]: e.target.value })} placeholder={placeholder}
                      className="w-full outline-none transition-colors duration-150" style={inputStyle}
                      onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--ctp-mauve)' }}
                      onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--ctp-surface1)' }} />
                  </label>
                ))}
              </div>
              <label className="block mb-5">
                <span className="text-xs font-medium mb-1.5 block" style={{ color: 'var(--ctp-subtext0)' }}>下载目录</span>
                <input value={form.download_path} onChange={(e) => setForm({ ...form, download_path: e.target.value })}
                  placeholder="/root/AniBt" className="w-full outline-none transition-colors duration-150" style={inputStyle}
                  onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--ctp-mauve)' }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--ctp-surface1)' }} />
              </label>

              <div className="flex gap-3 justify-end">
                <button type="button" onClick={() => {
                  setFormTesting(true); setFormTestResult(null)
                  testConnectionMutation.mutate({ url: form.url, username: form.username, password: form.password })
                }} disabled={formTesting || !form.url}
                  className="flex items-center gap-2 cursor-pointer transition-colors duration-150 disabled:opacity-40"
                  style={{ padding: '8px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 500,
                    background: 'transparent', color: 'var(--ctp-teal)', border: '1px solid var(--ctp-surface1)' }}>
                  {formTesting ? <Loader2 size={14} className="animate-spin" /> : <TestTube size={14} />}
                  测试连接
                </button>
                <button type="button" onClick={resetForm} className="cursor-pointer transition-colors duration-150"
                  style={{ padding: '8px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 500,
                    background: 'transparent', color: 'var(--ctp-subtext0)', border: '1px solid var(--ctp-surface1)' }}>
                  取消
                </button>
                <button type="submit" disabled={createMutation.isPending || updateMutation.isPending}
                  className="cursor-pointer transition-opacity duration-150 disabled:opacity-50"
                  style={{ padding: '8px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 500,
                    background: 'var(--ctp-mauve)', color: 'var(--ctp-crust)', border: 'none' }}>
                  {(createMutation.isPending || updateMutation.isPending) ? '保存中...' : editId ? '保存修改' : '添加实例'}
                </button>
              </div>

              {formTestResult && (
                <div className="mt-4 text-sm flex items-center gap-2"
                  style={{ color: formTestResult.success ? 'var(--ctp-green)' : 'var(--ctp-red)' }}>
                  {formTestResult.success ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                  {formTestResult.success ? `连接成功 — qBittorrent ${formTestResult.version}` : `连接失败: ${formTestResult.error}`}
                </div>
              )}
            </form>
          </div>
        </div>
      )}

      {/* Instance List */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2].map((n) => (
            <div key={n} className="py-4 flex items-center gap-3">
              <div className="w-2 h-2 rounded-full" style={{ background: 'var(--ctp-surface1)' }} />
              <div className="space-y-2 flex-1">
                <div className="h-3 w-24 rounded" style={{ background: 'var(--ctp-surface1)' }} />
                <div className="h-2.5 w-40 rounded" style={{ background: 'var(--ctp-surface1)' }} />
              </div>
            </div>
          ))}
        </div>
      ) : instances.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-sm" style={{ color: 'var(--ctp-overlay1)' }}>暂无实例</p>
          <p className="text-xs mt-1" style={{ color: 'var(--ctp-overlay0)' }}>点击「添加实例」开始管理 qBittorrent</p>
        </div>
      ) : (
        <div style={{
          background: 'var(--ctp-surface0)', border: '1px solid var(--ctp-surface1)',
          borderRadius: '12px', overflow: 'hidden',
        }}>
          {instances.map((inst: any, idx: number) => (
            <div key={inst.id}
              className="flex items-center justify-between px-6 py-4 transition-colors duration-150"
              style={{ borderBottom: idx < instances.length - 1 ? '1px solid var(--ctp-surface0)' : 'none' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--ctp-surface0)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}>
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: inst.status?.connected ? 'var(--ctp-green)' : 'var(--ctp-red)' }} />
                <div>
                  <p className="text-sm font-medium" style={{ color: 'var(--ctp-text)' }}>{inst.name}</p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--ctp-overlay1)', fontFamily: '"Geist Mono", monospace' }}>{inst.url}</p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                {inst.status?.connected && (
                  <>
                    <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--ctp-green)' }}>
                      <Upload size={11} /> {formatSpeed(inst.status.up_speed || 0)}
                    </span>
                    <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--ctp-teal)' }}>
                      <Download size={11} /> {formatSpeed(inst.status.dl_speed || 0)}
                    </span>
                    <span className="text-xs" style={{ color: 'var(--ctp-subtext0)' }}>{inst.status.total || 0} 种子</span>
                  </>
                )}
                {!inst.status?.connected && (
                  <span className="text-xs" style={{ color: 'var(--ctp-red)' }}>离线</span>
                )}
                <div className="flex gap-1 ml-2">
                  <button onClick={() => handleTest(inst.id)} disabled={testingId === inst.id}
                    className="p-1.5 rounded-md cursor-pointer transition-colors duration-150"
                    style={{ color: 'var(--ctp-overlay1)' }} title="测试连接"
                    onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--ctp-text)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--ctp-overlay1)' }}>
                    {testingId === inst.id ? <Loader2 size={14} className="animate-spin" /> : <TestTube size={14} />}
                  </button>
                  <button onClick={() => handleEdit(inst)}
                    className="p-1.5 rounded-md cursor-pointer transition-colors duration-150"
                    style={{ color: 'var(--ctp-overlay1)' }} title="编辑"
                    onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--ctp-text)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--ctp-overlay1)' }}>
                    <Pencil size={14} />
                  </button>
                  <button onClick={() => setDeleteConfirm(inst.id)}
                    className="p-1.5 rounded-md cursor-pointer transition-colors duration-150"
                    style={{ color: 'var(--ctp-overlay1)' }} title="删除"
                    onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--ctp-red)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--ctp-overlay1)' }}>
                    <Trash2 size={14} />
                  </button>
                </div>
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
            <p className="text-sm mb-6" style={{ color: 'var(--ctp-overlay1)' }}>此操作无法撤销，确定要删除此实例吗？</p>
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

      {/* Test Result Toast */}
      {testResult && (
        <div className="fixed bottom-6 right-6 flex items-center gap-2 px-4 py-2.5 text-sm font-medium z-50 cursor-pointer"
          style={{
            borderRadius: '8px', background: 'var(--ctp-surface0)',
            border: `1px solid ${testResult.success ? 'var(--ctp-green)' : 'var(--ctp-red)'}`,
            color: testResult.success ? 'var(--ctp-green)' : 'var(--ctp-red)',
            animation: 'fadeIn 0.2s ease-out',
          }}
          onClick={() => setTestResult(null)}>
          {testResult.success ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
          {testResult.success ? `连接成功 (v${testResult.version})` : `连接失败: ${testResult.error}`}
        </div>
      )}
    </div>
  )
}
