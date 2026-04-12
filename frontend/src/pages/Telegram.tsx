import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { telegramApi } from '../api/client'
import { Save, Send } from 'lucide-react'

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
      setTimeout(() => setSaved(false), 2000)
    },
  })

  const testMutation = useMutation({
    mutationFn: telegramApi.test,
    onSuccess: (data) => { setTestResult(data); setTimeout(() => setTestResult(null), 3000) },
  })

  if (isLoading) return <div style={{ color: 'var(--text-muted)' }}>加载中...</div>

  const toggleFields = [
    { key: 'notify_new_download', label: '新种子下载' },
    { key: 'notify_completed', label: '下载完成' },
    { key: 'notify_deleted', label: '种子删除' },
    { key: 'notify_paused', label: '种子暂停' },
    { key: 'notify_resumed', label: '种子恢复' },
    { key: 'notify_space_alert', label: '空间告警' },
    { key: 'daily_summary', label: '每日统计' },
  ]

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>Telegram 通知</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>配置 Telegram Bot 推送</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => testMutation.mutate()}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm cursor-pointer"
            style={{ color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
            <Send size={14} /> 测试发送
          </button>
          <button onClick={() => saveMutation.mutate(form)}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium text-white cursor-pointer"
            style={{ background: saved ? 'var(--success)' : 'var(--accent)' }}>
            <Save size={14} /> {saved ? '已保存 ✓' : '保存'}
          </button>
        </div>
      </div>

      <div className="space-y-4">
        {/* Connection */}
        <div className="rounded-2xl p-6" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>连接配置</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between py-2">
              <span className="text-sm" style={{ color: 'var(--text-primary)' }}>启用通知</span>
              <button onClick={() => setForm({ ...form, enabled: !form.enabled })}
                className="relative w-11 h-6 rounded-full transition-colors cursor-pointer"
                style={{ background: form.enabled ? 'var(--accent)' : 'var(--border)' }}>
                <div className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform"
                  style={{ left: form.enabled ? '22px' : '2px' }} />
              </button>
            </div>
            <label className="block">
              <span className="text-xs font-medium mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>Bot Token</span>
              <input value={form.bot_token || ''} onChange={(e) => setForm({ ...form, bot_token: e.target.value })}
                placeholder="123456:ABC-DEF..."
                className="w-full px-3.5 py-2.5 rounded-lg text-sm outline-none font-mono"
                style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
            </label>
            <label className="block">
              <span className="text-xs font-medium mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>Chat ID</span>
              <input value={form.chat_id || ''} onChange={(e) => setForm({ ...form, chat_id: e.target.value })}
                placeholder="-100123456789"
                className="w-full px-3.5 py-2.5 rounded-lg text-sm outline-none font-mono"
                style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
            </label>
          </div>
        </div>

        {/* Events */}
        <div className="rounded-2xl p-6" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>通知事件</h3>
          <div className="space-y-1">
            {toggleFields.map(({ key, label }) => (
              <div key={key} className="flex items-center justify-between py-2.5 border-b last:border-0"
                style={{ borderColor: 'var(--border)' }}>
                <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{label}</span>
                <button onClick={() => setForm({ ...form, [key]: !form[key] })}
                  className="relative w-11 h-6 rounded-full transition-colors cursor-pointer"
                  style={{ background: form[key] ? 'var(--accent)' : 'var(--border)' }}>
                  <div className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform"
                    style={{ left: form[key] ? '22px' : '2px' }} />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {testResult && (
        <div className="fixed bottom-6 right-6 px-5 py-3 rounded-xl text-sm font-medium shadow-xl z-50 cursor-pointer"
          style={{ background: testResult.success ? 'var(--success)' : 'var(--danger)', color: 'white' }}
          onClick={() => setTestResult(null)}>
          {testResult.success ? '✓ 测试消息已发送' : `✗ 发送失败: ${testResult.error}`}
        </div>
      )}
    </div>
  )
}
