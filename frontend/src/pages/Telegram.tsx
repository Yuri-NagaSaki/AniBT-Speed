import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { telegramApi } from '../api/client'
import { Save, Send, Bot, Bell, CheckCircle2, XCircle, Loader2 } from 'lucide-react'

const toggleFields = [
  { key: 'notify_new_download', label: '新种子下载', desc: '有新种子开始下载时通知' },
  { key: 'notify_completed', label: '下载完成', desc: '种子下载完成时通知' },
  { key: 'notify_deleted', label: '种子删除', desc: '种子被自动删除时通知' },
  { key: 'notify_paused', label: '种子暂停', desc: '种子被自动暂停时通知' },
  { key: 'notify_resumed', label: '种子恢复', desc: '种子被自动恢复时通知' },
  { key: 'notify_space_alert', label: '空间告警', desc: '存储空间不足时告警' },
  { key: 'daily_summary', label: '每日统计', desc: '每日定时发送运行数据摘要' },
]

export default function Telegram() {
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['telegram'], queryFn: telegramApi.get })
  const [form, setForm] = useState<any>({})
  const [saved, setSaved] = useState(false)
  const [testResult, setTestResult] = useState<any>(null)

  useEffect(() => { if (data) setForm(data) }, [data])

  const saveMutation = useMutation({
    mutationFn: telegramApi.update,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['telegram'] })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    },
  })

  const testMutation = useMutation({
    mutationFn: telegramApi.test,
    onSuccess: (data) => { setTestResult(data); setTimeout(() => setTestResult(null), 4000) },
    onError: (err: any) => { setTestResult({ success: false, error: err.message }); setTimeout(() => setTestResult(null), 4000) },
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: 'var(--border)', borderTopColor: 'transparent' }} />
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto" style={{ animation: 'fadeIn 0.4s ease-out' }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>Telegram 通知</h1>
          <p className="text-sm mt-1.5 font-medium" style={{ color: 'var(--text-secondary)' }}>配置 Telegram Bot 推送通知</p>
        </div>
        <div className="flex gap-2.5">
          <button
            onClick={() => testMutation.mutate()}
            disabled={testMutation.isPending}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium cursor-pointer transition-all duration-200"
            style={{ color: 'var(--text-secondary)', background: 'var(--bg-elevated)', border: '1px solid var(--border)', backdropFilter: 'blur(8px)' }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--border-strong)'; e.currentTarget.style.color = 'var(--text-primary)' }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)' }}
          >
            {testMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            测试发送
          </button>
          <button
            onClick={() => saveMutation.mutate(form)}
            disabled={saveMutation.isPending}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white cursor-pointer transition-all duration-300 disabled:opacity-50"
            style={{
              background: saved ? 'var(--success)' : 'var(--gradient-accent)',
              boxShadow: saved ? '0 4px 20px var(--success-glow)' : '0 4px 20px var(--accent-glow)',
            }}
            onMouseEnter={(e) => { if (!saved) e.currentTarget.style.transform = 'translateY(-1px)' }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)' }}
          >
            <Save size={14} /> {saved ? '已保存 ✓' : '保存'}
          </button>
        </div>
      </div>

      <div className="space-y-5">
        {/* Connection Card */}
        <div
          className="rounded-2xl overflow-hidden"
          style={{
            background: 'var(--bg-card)',
            backdropFilter: 'blur(16px)',
            border: '1px solid var(--border)',
            boxShadow: '0 4px 24px rgba(0,0,0,0.15)',
          }}
        >
          <div className="px-6 py-4 flex items-center gap-3" style={{ borderBottom: '1px solid var(--border)' }}>
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: 'var(--gradient-subtle)', border: '1px solid rgba(99,102,241,0.2)' }}
            >
              <Bot size={15} style={{ color: 'var(--accent)' }} />
            </div>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>连接配置</h3>
          </div>
          <div className="p-6 space-y-5">
            {/* Enable toggle */}
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>启用通知</span>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>开启 Telegram Bot 消息推送</p>
              </div>
              <button onClick={() => setForm({ ...form, enabled: !form.enabled })}
                className="relative w-12 h-7 rounded-full transition-all duration-300 cursor-pointer"
                style={{
                  background: form.enabled ? 'linear-gradient(135deg, #6366f1, #8b5cf6)' : 'rgba(63,63,70,0.6)',
                  boxShadow: form.enabled ? '0 0 16px var(--accent-glow), inset 0 1px 2px rgba(255,255,255,0.1)' : 'inset 0 1px 3px rgba(0,0,0,0.3)',
                }}>
                <div className="absolute top-[3px] w-[22px] h-[22px] rounded-full bg-white shadow-lg transition-all duration-300"
                  style={{
                    left: form.enabled ? '25px' : '3px',
                    boxShadow: form.enabled ? '0 2px 8px rgba(99,102,241,0.4)' : '0 2px 4px rgba(0,0,0,0.3)',
                  }} />
              </button>
            </div>

            {/* Bot Token */}
            <label className="block">
              <span className="text-xs font-semibold mb-2 block tracking-wide" style={{ color: 'var(--text-secondary)' }}>Bot Token</span>
              <input
                value={form.bot_token || ''}
                onChange={(e) => setForm({ ...form, bot_token: e.target.value })}
                placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
                className="w-full px-4 py-3 rounded-xl text-sm outline-none font-mono transition-all duration-200"
                style={{ background: 'rgba(9,9,11,0.6)', border: '1px solid var(--border)', color: 'var(--text-primary)', letterSpacing: '0.02em' }}
                onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.boxShadow = '0 0 0 3px var(--accent-glow)' }}
                onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.boxShadow = 'none' }}
              />
            </label>

            {/* Chat ID */}
            <label className="block">
              <span className="text-xs font-semibold mb-2 block tracking-wide" style={{ color: 'var(--text-secondary)' }}>Chat ID</span>
              <input
                value={form.chat_id || ''}
                onChange={(e) => setForm({ ...form, chat_id: e.target.value })}
                placeholder="-100123456789"
                className="w-full px-4 py-3 rounded-xl text-sm outline-none font-mono transition-all duration-200"
                style={{ background: 'rgba(9,9,11,0.6)', border: '1px solid var(--border)', color: 'var(--text-primary)', letterSpacing: '0.02em' }}
                onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.boxShadow = '0 0 0 3px var(--accent-glow)' }}
                onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.boxShadow = 'none' }}
              />
            </label>
          </div>
        </div>

        {/* Event Toggles Card */}
        <div
          className="rounded-2xl overflow-hidden"
          style={{
            background: 'var(--bg-card)',
            backdropFilter: 'blur(16px)',
            border: '1px solid var(--border)',
            boxShadow: '0 4px 24px rgba(0,0,0,0.15)',
          }}
        >
          <div className="px-6 py-4 flex items-center gap-3" style={{ borderBottom: '1px solid var(--border)' }}>
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, rgba(245,158,11,0.15), rgba(245,158,11,0.05))', border: '1px solid rgba(245,158,11,0.2)' }}
            >
              <Bell size={15} style={{ color: 'var(--warning)' }} />
            </div>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>通知事件</h3>
          </div>
          <div>
            {toggleFields.map(({ key, label, desc }, i) => (
              <div
                key={key}
                className="flex items-center justify-between px-6 py-4 transition-colors duration-200"
                style={{ borderBottom: i < toggleFields.length - 1 ? '1px solid var(--border)' : 'none' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(39,39,42,0.3)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
              >
                <div>
                  <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{label}</span>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{desc}</p>
                </div>
                <button onClick={() => setForm({ ...form, [key]: !form[key] })}
                  className="relative w-12 h-7 rounded-full transition-all duration-300 cursor-pointer shrink-0 ml-4"
                  style={{
                    background: form[key] ? 'linear-gradient(135deg, #6366f1, #8b5cf6)' : 'rgba(63,63,70,0.6)',
                    boxShadow: form[key] ? '0 0 16px var(--accent-glow), inset 0 1px 2px rgba(255,255,255,0.1)' : 'inset 0 1px 3px rgba(0,0,0,0.3)',
                  }}>
                  <div className="absolute top-[3px] w-[22px] h-[22px] rounded-full bg-white shadow-lg transition-all duration-300"
                    style={{
                      left: form[key] ? '25px' : '3px',
                      boxShadow: form[key] ? '0 2px 8px rgba(99,102,241,0.4)' : '0 2px 4px rgba(0,0,0,0.3)',
                    }} />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Toast */}
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
          {testResult.success ? '测试消息已发送' : `发送失败: ${testResult.error}`}
        </div>
      )}

      {saved && (
        <div
          className="fixed top-6 right-6 flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold text-white z-50"
          style={{ background: 'var(--success)', boxShadow: '0 8px 32px rgba(34,197,94,0.3)', animation: 'slideUp 0.3s ease-out' }}
        >
          <Save size={15} /> 设置已保存
        </div>
      )}
    </div>
  )
}
