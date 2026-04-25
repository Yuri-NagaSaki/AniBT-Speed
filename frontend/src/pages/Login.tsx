import { useState, type FormEvent } from 'react'
import { authApi } from '../api/client'
import { Lock, AlertCircle, Loader2 } from 'lucide-react'
import { Button, Field, Input } from '../components/ui'

export default function Login() {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await authApi.login(password)
      window.location.href = '/'
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '密码错误')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-shell">
      <div className="login-card">
        <div style={{ marginBottom: 28 }}>
          <div className="brand-mark" style={{ marginInline: 'auto' }}>A</div>
          <h1 className="page-title" style={{ fontSize: 30, textAlign: 'center' }}>AniBT-Speed</h1>
          <p className="page-description" style={{ textAlign: 'center', marginInline: 'auto' }}>
            种群加速管理平台
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <Field label="管理密码">
            <div style={{ position: 'relative' }}>
              <Lock size={15} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="请输入密码"
                autoFocus
                style={{ paddingLeft: 40 }}
              />
            </div>
          </Field>

          {error && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16, color: 'var(--ctp-red)', fontSize: 13 }}>
              <AlertCircle size={14} />
              {error}
            </div>
          )}

          <Button
            type="submit"
            disabled={loading || !password}
            style={{ width: '100%', marginTop: 22 }}
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : null}
            {loading ? '登录中...' : '进入控制台'}
          </Button>
        </form>
      </div>
    </div>
  )
}
