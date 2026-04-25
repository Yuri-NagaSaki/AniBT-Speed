import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { telegramApi } from '../api/client'
import { Save, Send, CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import { Button, Input, PageHeader, SectionLabel, Toggle } from '../components/ui'

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
  const { data, isLoading } = useQuery({ queryKey: ['telegram'], queryFn: telegramApi.get, staleTime: 60000 })
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
      <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}>
        <div style={{
          width: 28, height: 28, borderRadius: '50%',
          border: '2px solid var(--ctp-surface2)',
          borderTopColor: 'transparent',
          animation: 'spin 0.8s linear infinite',
        }} />
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="Telegram 通知"
        description="配置 Telegram Bot 推送通知"
        kicker="Notification"
        actions={(
          <div style={{ display: 'flex', gap: 12 }}>
            <Button
              variant="secondary"
              onClick={() => testMutation.mutate()}
              disabled={testMutation.isPending}
            >
              {testMutation.isPending ? <Loader2 size={15} style={{ animation: 'spin 0.8s linear infinite' }} /> : <Send size={15} />}
              测试发送
            </Button>
            <Button
              onClick={() => saveMutation.mutate(form)}
              disabled={saveMutation.isPending}
              style={{ background: saved ? 'var(--ctp-green)' : undefined }}
            >
              <Save size={15} /> {saved ? '已保存 ✓' : '保存'}
            </Button>
          </div>
        )}
      />

      {/* Connection settings */}
      <div style={{ marginBottom: 48 }}>
        <SectionLabel>连接设置</SectionLabel>

        <div className="form-panel">
          <div className="setting-row" style={{ paddingTop: 0 }}>
            <div>
              <span className="field-label" style={{ color: 'var(--text-primary)' }}>启用通知</span>
              <p className="field-help" style={{ marginTop: 7 }}>开启 Telegram Bot 消息推送</p>
            </div>
            <div className="setting-control">
              <Toggle checked={!!form.enabled} onCheckedChange={(enabled) => setForm({ ...form, enabled })} label="启用通知" />
            </div>
          </div>
          <div className="form-grid-wide">
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--ctp-subtext0)', marginBottom: 10 }}>
              Bot Token
            </label>
            <Input
              value={form.bot_token || ''}
              onChange={(e) => setForm({ ...form, bot_token: e.target.value })}
              placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
              className="mono"
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--ctp-subtext0)', marginBottom: 10 }}>
              Chat ID
            </label>
            <Input
              value={form.chat_id || ''}
              onChange={(e) => setForm({ ...form, chat_id: e.target.value })}
              placeholder="-100123456789"
              className="mono"
            />
          </div>
          </div>
        </div>
      </div>

      {/* Notification events */}
      <div>
        <SectionLabel>通知事件</SectionLabel>
        <div className="form-panel">
          {toggleFields.map(({ key, label, desc }, i) => (
            <div
              key={key}
              className="setting-row"
              style={{ borderBottom: i < toggleFields.length - 1 ? undefined : '0' }}
            >
              <div>
                <span className="field-label" style={{ color: 'var(--text-primary)' }}>{label}</span>
                <p className="field-help" style={{ marginTop: 7 }}>{desc}</p>
              </div>
              <div className="setting-control">
                <Toggle checked={!!form[key]} onCheckedChange={(checked) => setForm({ ...form, [key]: checked })} label={label} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Test result toast */}
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
          {testResult.success ? '测试消息已发送' : `发送失败: ${testResult.error}`}
        </div>
      )}

      {saved && (
        <div style={{
          position: 'fixed', top: 24, right: 24, zIndex: 50,
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '14px 20px', borderRadius: 10,
          fontSize: 13, fontWeight: 500,
          background: 'var(--ctp-surface0)',
          border: '1px solid var(--ctp-green)', color: 'var(--ctp-green)',
          animation: 'fadeIn 0.2s ease-out',
        }}>
          <Save size={15} /> 设置已保存
        </div>
      )}
    </div>
  )
}
