import type { ReactNode } from 'react'
import { useLocation, useNavigate } from '@tanstack/react-router'
import { clearToken } from '../api/client'
import {
  LayoutDashboard,
  Server,
  Rss,
  HardDrive,
  ListOrdered,
  Gauge,
  MessageSquare,
  ScrollText,
  LogOut,
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

  function handleLogout() {
    clearToken()
    navigate({ to: '/login' })
  }

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--ctp-base)' }}>
      {/* Sidebar */}
      <aside
        className="w-[240px] shrink-0 flex flex-col"
        style={{ background: 'var(--ctp-mantle)' }}
      >
        {/* Logo */}
        <div className="px-5 pt-6 pb-5">
          <h1
            className="text-[15px] font-semibold tracking-tight"
            style={{ color: 'var(--ctp-text)' }}
          >
            AniBT-Speed
          </h1>
          <p
            className="text-[11px] mt-0.5"
            style={{ color: 'var(--ctp-subtext0)' }}
          >
            种群加速
          </p>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-2 px-3 space-y-0.5 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path
            return (
              <button
                key={item.path}
                onClick={() => navigate({ to: item.path })}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors duration-150 cursor-pointer"
                style={{
                  background: isActive ? 'var(--ctp-surface0)' : 'transparent',
                  color: isActive ? 'var(--ctp-mauve)' : 'var(--ctp-overlay1)',
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.background = 'var(--ctp-surface0)'
                    e.currentTarget.style.color = 'var(--ctp-text)'
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.background = 'transparent'
                    e.currentTarget.style.color = 'var(--ctp-overlay1)'
                  }
                }}
              >
                <item.icon size={16} />
                <span>{item.label}</span>
              </button>
            )
          })}
        </nav>

        {/* Footer */}
        <div className="px-5 pb-5 space-y-3">
          {/* PBH status */}
          <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--ctp-overlay1)' }}>
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ background: 'var(--ctp-green)' }}
            />
            <span>PeerBanHelper</span>
          </div>

          {/* Logout */}
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 text-xs cursor-pointer transition-colors duration-150"
            style={{ color: 'var(--ctp-overlay1)' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--ctp-text)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--ctp-overlay1)' }}
          >
            <LogOut size={13} />
            <span>退出登录</span>
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto" style={{ background: 'var(--ctp-base)' }}>
        <div className="mx-auto max-w-[1200px] px-6 py-12 md:px-12">
          {children}
        </div>
      </main>
    </div>
  )
}
