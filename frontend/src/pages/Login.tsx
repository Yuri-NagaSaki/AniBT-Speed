import { useState, type FormEvent } from 'react'
import { authApi } from '../api/client'
import { Lock, AlertCircle, Loader2 } from 'lucide-react'

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
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: 'var(--ctp-base)' }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '360px',
          background: 'var(--ctp-surface0)',
          border: '1px solid var(--ctp-surface1)',
          borderRadius: '12px',
          padding: '24px',
          animation: 'fadeIn 0.3s ease-out',
        }}
      >
        <div className="text-center mb-6">
          <h1 className="text-xl font-semibold" style={{ color: 'var(--ctp-text)' }}>
            AniBT-Speed
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--ctp-subtext0)' }}>
            种群加速管理平台
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block text-xs font-medium mb-2" style={{ color: 'var(--ctp-subtext0)' }}>
              管理密码
            </label>
            <div className="relative">
              <Lock size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--ctp-overlay1)' }} />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="请输入密码"
                autoFocus
                className="w-full outline-none transition-colors duration-150"
                style={{
                  paddingLeft: '36px',
                  paddingRight: '14px',
                  paddingTop: '10px',
                  paddingBottom: '10px',
                  borderRadius: '8px',
                  fontSize: '13px',
                  background: 'var(--ctp-surface0)',
                  border: '1px solid var(--ctp-surface1)',
                  color: 'var(--ctp-text)',
                }}
                onFocus={(e) => { e.target.style.borderColor = 'var(--ctp-mauve)' }}
                onBlur={(e) => { e.target.style.borderColor = 'var(--ctp-surface1)' }}
              />
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 mb-4 text-sm" style={{ color: 'var(--ctp-red)' }}>
              <AlertCircle size={14} />
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !password}
            className="w-full flex items-center justify-center gap-2 cursor-pointer transition-opacity duration-150 disabled:opacity-40"
            style={{
              padding: '10px 16px',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: 500,
              background: 'var(--ctp-mauve)',
              color: 'var(--ctp-crust)',
              border: 'none',
            }}
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : null}
            {loading ? '登录中...' : '登 录'}
          </button>
        </form>
      </div>
    </div>
  )
}
