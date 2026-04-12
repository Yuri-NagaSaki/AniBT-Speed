import type { ReactNode } from 'react'
import { useLocation, useNavigate } from '@tanstack/react-router'
import { clearToken } from '../api/client'
import {
  LayoutDashboard, Server, Rss, HardDrive,
  ListOrdered, Gauge, MessageSquare, ScrollText, LogOut,
} from 'lucide-react'

const navItems = [
  { path: '/', label: '仪表盘', icon: LayoutDashboard },
  { path: '/instances', label: '实例管理', icon: Server },
  { path: '/rss', label: 'RSS 管理', icon: Rss },
  { path: '/space-policy', label: '空间策略', icon: HardDrive },
  { path: '/queue-policy', label: '队列策略', icon: ListOrdered },
  { path: '/rate-limit', label: '限速策略', icon: Gauge },
  { path: '/telegram', label: 'Telegram', icon: MessageSquare },
  { path: '/logs', label: '日志', icon: ScrollText },
]

export default function Layout({ children }: { children: ReactNode }) {
  const location = useLocation()
  const navigate = useNavigate()

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--ctp-base)' }}>
      {/* Sidebar */}
      <aside style={{
        width: 280,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--ctp-mantle)',
        borderRight: '1px solid var(--ctp-surface0)',
      }}>
        {/* Logo */}
        <div style={{ padding: '36px 28px 40px' }}>
          <div style={{ fontSize: 17, fontWeight: 600, color: 'var(--ctp-text)', letterSpacing: '-0.02em' }}>
            AniBT-Speed
          </div>
          <div style={{ fontSize: 12, color: 'var(--ctp-overlay1)', marginTop: 6, letterSpacing: '0.04em' }}>
            种群加速管理
          </div>
        </div>

        {/* Navigation */}
        <nav style={{ flex: 1, padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 4, overflowY: 'auto' }}>
          {navItems.map((item) => {
            const active = location.pathname === item.path
            return (
              <button
                key={item.path}
                onClick={() => navigate({ to: item.path })}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  padding: '12px 16px',
                  borderRadius: 10,
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 14,
                  fontWeight: active ? 500 : 400,
                  fontFamily: 'inherit',
                  background: active ? 'var(--ctp-surface0)' : 'transparent',
                  color: active ? 'var(--ctp-mauve)' : 'var(--ctp-overlay1)',
                  transition: 'all 0.15s ease',
                  textAlign: 'left',
                  width: '100%',
                }}
                onMouseEnter={(e) => {
                  if (!active) {
                    e.currentTarget.style.background = 'var(--ctp-surface0)'
                    e.currentTarget.style.color = 'var(--ctp-subtext1)'
                  }
                }}
                onMouseLeave={(e) => {
                  if (!active) {
                    e.currentTarget.style.background = 'transparent'
                    e.currentTarget.style.color = 'var(--ctp-overlay1)'
                  }
                }}
              >
                <item.icon size={18} />
                <span>{item.label}</span>
              </button>
            )
          })}
        </nav>

        {/* Footer */}
        <div style={{ padding: '24px 28px 32px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: 'var(--ctp-overlay1)' }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--ctp-green)', flexShrink: 0 }} />
            PeerBanHelper
          </div>
          <button
            onClick={() => { clearToken(); navigate({ to: '/login' }) }}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: 0,
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 13, color: 'var(--ctp-overlay1)', fontFamily: 'inherit',
              transition: 'color 0.15s ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--ctp-text)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--ctp-overlay1)' }}
          >
            <LogOut size={15} />
            退出登录
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main style={{ flex: 1, overflowY: 'auto', background: 'var(--ctp-base)' }}>
        <div style={{ maxWidth: 1080, margin: '0 auto', padding: '56px 56px 80px' }}>
          {children}
        </div>
      </main>
    </div>
  )
}
