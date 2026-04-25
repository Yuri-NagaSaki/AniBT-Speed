import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { instancesApi } from '../api/client'
import { Plus, Trash2, TestTube, Pencil, X, Upload, Download, Loader2, CheckCircle2, XCircle, Tag } from 'lucide-react'
import { Button, PageHeader } from '../components/ui'

function formatSpeed(bytes: number): string {
  if (!bytes) return '0 B/s'
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}

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

export default function Instances() {
  const queryClient = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState({ name: '', url: '', username: '', password: '', download_path: '', tag: '' })
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)

  const { data: instances = [], isLoading } = useQuery({
    queryKey: ['instances'],
    queryFn: instancesApi.list,
    refetchInterval: 5000,
    staleTime: 3000,
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
    setForm({ name: '', url: '', username: '', password: '', download_path: '', tag: '' })
    setShowForm(false)
    setEditId(null)
    setFormTestResult(null)
    setFormTesting(false)
  }

  function handleEdit(inst: any) {
    setForm({ name: inst.name, url: inst.url, username: inst.username, password: '', download_path: inst.download_path || '', tag: inst.tag || '' })
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

  return (
    <div style={{ animation: 'fadeIn 0.3s ease-out' }}>
      <PageHeader
        title="实例管理"
        description="管理 qBittorrent 实例连接、下载目录与自动标签"
        kicker="qBittorrent"
        actions={(
          <Button onClick={() => { resetForm(); setShowForm(true) }}>
            <Plus size={16} /> 添加实例
          </Button>
        )}
      />

      {/* Add/Edit Modal */}
      {showForm && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 40,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          animation: 'fadeIn 0.15s ease-out',
        }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(17,17,27,0.7)' }} onClick={resetForm} />
          <div style={{
            position: 'relative', width: '100%', maxWidth: 560, margin: '0 16px',
            background: 'var(--ctp-surface0)', border: '1px solid var(--ctp-surface1)',
            borderRadius: 16, padding: 40, animation: 'slideUp 0.2s ease-out',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32 }}>
              <h3 style={{ fontSize: 18, fontWeight: 600, color: 'var(--ctp-text)' }}>
                {editId ? '编辑实例' : '添加新实例'}
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
                {[
                  { key: 'name', label: '名称', placeholder: '例如: 主服务器' },
                  { key: 'url', label: 'WebUI 地址', placeholder: 'http://localhost:8181' },
                  { key: 'username', label: '用户名', placeholder: 'admin' },
                  { key: 'password', label: '密码', placeholder: '••••••', type: 'password' },
                ].map(({ key, label, placeholder, type }) => (
                  <div key={key}>
                    <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--ctp-subtext0)', marginBottom: 10 }}>
                      {label}
                    </label>
                    <input
                      type={type || 'text'}
                      value={(form as any)[key]}
                      onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                      placeholder={placeholder}
                      style={inputStyle}
                      onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--ctp-mauve)' }}
                      onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--ctp-surface1)' }}
                    />
                  </div>
                ))}
              </div>
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--ctp-subtext0)', marginBottom: 10 }}>
                  下载目录
                </label>
                <input
                  value={form.download_path}
                  onChange={(e) => setForm({ ...form, download_path: e.target.value })}
                  placeholder="/root/AniBt"
                  style={inputStyle}
                  onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--ctp-mauve)' }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--ctp-surface1)' }}
                />
              </div>
              <div style={{ marginBottom: 32 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--ctp-subtext0)', marginBottom: 10 }}>
                  自动标签
                </label>
                <input
                  value={form.tag}
                  onChange={(e) => setForm({ ...form, tag: e.target.value })}
                  placeholder="如 anibt"
                  style={inputStyle}
                  onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--ctp-mauve)' }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--ctp-surface1)' }}
                />
              </div>

              <div style={{ display: 'flex', gap: 16, justifyContent: 'flex-end' }}>
                <button type="button" onClick={() => {
                  setFormTesting(true); setFormTestResult(null)
                  testConnectionMutation.mutate({ url: form.url, username: form.username, password: form.password })
                }} disabled={formTesting || !form.url}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '12px 24px', borderRadius: 10, cursor: 'pointer',
                    fontSize: 14, fontWeight: 500, fontFamily: 'inherit',
                    background: 'transparent', color: 'var(--ctp-teal)',
                    border: '1px solid var(--ctp-surface1)',
                    opacity: (formTesting || !form.url) ? 0.4 : 1,
                    transition: 'opacity 0.15s ease',
                  }}>
                  {formTesting ? <Loader2 size={15} style={{ animation: 'spin 0.8s linear infinite' }} /> : <TestTube size={15} />}
                  测试连接
                </button>
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
                  {(createMutation.isPending || updateMutation.isPending) ? '保存中...' : editId ? '保存修改' : '添加实例'}
                </button>
              </div>

              {formTestResult && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8, marginTop: 20,
                  fontSize: 13, color: formTestResult.success ? 'var(--ctp-green)' : 'var(--ctp-red)',
                }}>
                  {formTestResult.success ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
                  {formTestResult.success ? `连接成功 — qBittorrent ${formTestResult.version}` : `连接失败: ${formTestResult.error}`}
                </div>
              )}
            </form>
          </div>
        </div>
      )}

      {/* Instance List */}
      {isLoading ? (
        <div>
          {[1, 2].map((n) => (
            <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '20px 0' }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--ctp-surface1)' }} />
              <div>
                <div style={{ height: 14, width: 96, borderRadius: 4, background: 'var(--ctp-surface1)', marginBottom: 8 }} />
                <div style={{ height: 12, width: 160, borderRadius: 4, background: 'var(--ctp-surface1)' }} />
              </div>
            </div>
          ))}
        </div>
      ) : instances.length === 0 ? (
        <div style={{ padding: '64px 0', textAlign: 'center' as const }}>
          <p style={{ fontSize: 14, color: 'var(--ctp-overlay1)' }}>暂无实例</p>
          <p style={{ fontSize: 12, color: 'var(--ctp-overlay0)', marginTop: 8 }}>点击「添加实例」开始管理 qBittorrent</p>
        </div>
      ) : (
        <div style={{
          background: 'var(--ctp-surface0)',
          border: '1px solid var(--ctp-surface1)',
          borderRadius: 14,
          overflow: 'hidden',
        }}>
          {instances.map((inst: any, idx: number) => (
            <div key={inst.id} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '20px 24px',
              borderBottom: idx < instances.length - 1 ? '1px solid var(--ctp-surface1)' : 'none',
              transition: 'background 0.15s ease',
            }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(69,71,90,0.3)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{
                  width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                  background: inst.status?.connected ? 'var(--ctp-green)' : 'var(--ctp-red)',
                }} />
                <div>
                  <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--ctp-text)', lineHeight: 1.4 }}>{inst.name}</p>
                  <p style={{ fontSize: 12, color: 'var(--ctp-overlay1)', marginTop: 4, fontFamily: '"Geist Mono", monospace' }}>{inst.url}</p>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                {inst.status?.connected && (
                  <>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--ctp-green)' }}>
                      <Upload size={12} /> {formatSpeed(inst.status.up_speed || 0)}
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--ctp-teal)' }}>
                      <Download size={12} /> {formatSpeed(inst.status.dl_speed || 0)}
                    </span>
                    <span style={{ fontSize: 13, color: 'var(--ctp-subtext0)' }}>{inst.status.total || 0} 种子</span>
                    {inst.tag && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, color: 'var(--ctp-mauve)' }}>
                        <Tag size={12} /> {inst.tag}
                      </span>
                    )}
                  </>
                )}
                {!inst.status?.connected && (
                  <span style={{ fontSize: 13, color: 'var(--ctp-red)' }}>离线</span>
                )}
                <div style={{ display: 'flex', gap: 4, marginLeft: 8 }}>
                  {([
                    { icon: TestTube, title: '测试连接', onClick: () => handleTest(inst.id), loading: testingId === inst.id },
                    { icon: Pencil, title: '编辑', onClick: () => handleEdit(inst) },
                    { icon: Trash2, title: '删除', onClick: () => setDeleteConfirm(inst.id), hoverColor: 'var(--ctp-red)' },
                  ] as const).map((btn, bi) => (
                    <button key={bi} onClick={btn.onClick} title={btn.title}
                      disabled={'loading' in btn && btn.loading}
                      style={{
                        padding: 8, borderRadius: 8, border: 'none', cursor: 'pointer',
                        background: 'none', color: 'var(--ctp-overlay1)',
                        transition: 'color 0.15s ease',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = ('hoverColor' in btn ? btn.hoverColor : 'var(--ctp-text)') as string }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--ctp-overlay1)' }}>
                      {'loading' in btn && btn.loading
                        ? <Loader2 size={15} style={{ animation: 'spin 0.8s linear infinite' }} />
                        : <btn.icon size={15} />}
                    </button>
                  ))}
                </div>
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
            <p style={{ fontSize: 14, color: 'var(--ctp-overlay1)', marginBottom: 32, lineHeight: 1.6 }}>此操作无法撤销，确定要删除此实例吗？</p>
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

      {/* Test Result Toast */}
      {testResult && (
        <div
          onClick={() => setTestResult(null)}
          style={{
            position: 'fixed', bottom: 24, right: 24, zIndex: 50,
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '14px 20px', borderRadius: 10, cursor: 'pointer',
            fontSize: 13, fontWeight: 500,
            background: 'var(--ctp-surface0)',
            border: `1px solid ${testResult.success ? 'var(--ctp-green)' : 'var(--ctp-red)'}`,
            color: testResult.success ? 'var(--ctp-green)' : 'var(--ctp-red)',
            animation: 'fadeIn 0.2s ease-out',
          }}>
          {testResult.success ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
          {testResult.success ? `连接成功 (v${testResult.version})` : `连接失败: ${testResult.error}`}
        </div>
      )}
    </div>
  )
}
