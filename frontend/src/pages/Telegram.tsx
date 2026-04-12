import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { telegramApi } from '../api/client'
import { Save, Send, CheckCircle2, XCircle, Loader2 } from 'lucide-react'

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
        <div className="w-7 h-7 rounded-full border-2 border-t-transparent animate-spin"
          style={{ borderColor: 'var(--ctp-surface2)', borderTopColor: 'transparent' }} />
      </div>
    )
  }

  const inputStyle: React.CSSProperties = {
    padding: '10px 14px',
    borderRadius: '8px',
    fontSize: '13px',
    background: 'var(--ctp-surface0)',
    border: '1px solid var(--ctp-surface1)',
    color: 'var(--ctp-text)',
    fontFamily: '"Geist Mono", monospace',
    width: '100%',
  }

  return (
    <div className="max-w-3xl mx-auto" style={{ animation: 'fadeIn 0.3s ease-out' }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-12">
        <div>
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--ctp-text)' }}>Telegram 通知</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--ctp-subtext0)' }}>配置 Telegram Bot 推送通知</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => testMutation.mutate()}
            disabled={testMutation.isPending}
            className="flex items-center gap-2 cursor-pointer transition-colors duration-150"
            style={{
              padding: '8px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 500,
              background: 'transparent', color: 'var(--ctp-teal)', border: '1px solid var(--ctp-surface1)',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--ctp-surface2)' }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--ctp-surface1)' }}
          >
            {testMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            测试发送
          </button>
          <button
            onClick={() => saveMutation.mutate(form)}
            disabled={saveMutation.isPending}
            className="flex items-center gap-2 cursor-pointer transition-opacity duration-150 disabled:opacity-50"
            style={{
              padding: '8px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 500,
              background: saved ? 'var(--ctp-green)' : 'var(--ctp-mauve)',
              color: 'var(--ctp-crust)', border: 'none',
            }}
          >
            <Save size={14} /> {saved ? '已保存 ✓' : '保存'}
          </button>
        </div>
      </div>

      {/* Connection settings */}
      <div className="mb-12">
        <h2 className="text-xs font-medium tracking-widest uppercase mb-4" style={{ color: 'var(--ctp-subtext0)' }}>
          连接设置
        </h2>
        <div className="space-y-5">
          {/* Enable toggle */}
          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm font-medium" style={{ color: 'var(--ctp-text)' }}>启用通知</span>
              <p className="text-xs mt-0.5" style={{ color: 'var(--ctp-overlay1)' }}>开启 Telegram Bot 消息推送</p>
            </div>
            <button onClick={() => setForm({ ...form, enabled: !form.enabled })}
              className="relative w-11 h-6 rounded-full transition-colors duration-150 cursor-pointer"
              style={{ background: form.enabled ? 'var(--ctp-mauve)' : 'var(--ctp-surface2)' }}>
              <div className="absolute top-[2px] w-5 h-5 rounded-full transition-all duration-150"
                style={{ left: form.enabled ? '22px' : '2px', background: form.enabled ? 'var(--ctp-crust)' : 'var(--ctp-overlay0)' }} />
            </button>
          </div>

          <label className="block">
            <span className="text-xs font-medium mb-1.5 block" style={{ color: 'var(--ctp-subtext0)' }}>Bot Token</span>
            <input
              value={form.bot_token || ''}
              onChange={(e) => setForm({ ...form, bot_token: e.target.value })}
              placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
              className="outline-none transition-colors duration-150"
              style={inputStyle}
              onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--ctp-mauve)' }}
              onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--ctp-surface1)' }}
            />
          </label>

          <label className="block">
            <span className="text-xs font-medium mb-1.5 block" style={{ color: 'var(--ctp-subtext0)' }}>Chat ID</span>
            <input
              value={form.chat_id || ''}
              onChange={(e) => setForm({ ...form, chat_id: e.target.value })}
              placeholder="-100123456789"
              className="outline-none transition-colors duration-150"
              style={inputStyle}
              onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--ctp-mauve)' }}
              onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--ctp-surface1)' }}
            />
          </label>
        </div>
      </div>

      {/* Notification events */}
      <div>
        <h2 className="text-xs font-medium tracking-widest uppercase mb-4" style={{ color: 'var(--ctp-subtext0)' }}>
          通知事件
        </h2>
        <div>
          {toggleFields.map(({ key, label, desc }, i) => (
            <div
              key={key}
              className="flex items-center justify-between py-4 transition-colors duration-150"
              style={{ borderBottom: i < toggleFields.length - 1 ? '1px solid var(--ctp-surface0)' : 'none' }}
            >
              <div>
                <span className="text-sm font-medium" style={{ color: 'var(--ctp-text)' }}>{label}</span>
                <p className="text-xs mt-0.5" style={{ color: 'var(--ctp-overlay1)' }}>{desc}</p>
              </div>
              <button onClick={() => setForm({ ...form, [key]: !form[key] })}
                className="relative w-11 h-6 rounded-full transition-colors duration-150 cursor-pointer shrink-0 ml-4"
                style={{ background: form[key] ? 'var(--ctp-mauve)' : 'var(--ctp-surface2)' }}>
                <div className="absolute top-[2px] w-5 h-5 rounded-full transition-all duration-150"
                  style={{ left: form[key] ? '22px' : '2px', background: form[key] ? 'var(--ctp-crust)' : 'var(--ctp-overlay0)' }} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Test result toast */}
      {testResult && (
        <div
          className="fixed bottom-6 right-6 flex items-center gap-2 px-4 py-2.5 text-sm font-medium z-50 cursor-pointer"
          style={{
            borderRadius: '8px', background: 'var(--ctp-surface0)',
            border: `1px solid ${testResult.success ? 'var(--ctp-green)' : 'var(--ctp-red)'}`,
            color: testResult.success ? 'var(--ctp-green)' : 'var(--ctp-red)',
            animation: 'fadeIn 0.2s ease-out',
          }}
          onClick={() => setTestResult(null)}
        >
          {testResult.success ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
          {testResult.success ? '测试消息已发送' : `发送失败: ${testResult.error}`}
        </div>
      )}

      {saved && (
        <div
          className="fixed top-6 right-6 flex items-center gap-2 px-4 py-2.5 text-sm font-medium z-50"
          style={{
            borderRadius: '8px', background: 'var(--ctp-surface0)',
            border: '1px solid var(--ctp-green)', color: 'var(--ctp-green)',
            animation: 'fadeIn 0.2s ease-out',
          }}
        >
          <Save size={14} /> 设置已保存
        </div>
      )}
    </div>
  )
}
