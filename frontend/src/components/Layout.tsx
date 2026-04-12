import type { ReactNode } from 'react'
import { useLocation, useNavigate } from '@tanstack/react-router'
import {
  LayoutDashboard,
  Server,
  Rss,
  HardDrive,
  ListOrdered,
  Gauge,
  Shield,
  MessageSquare,
  ScrollText,
  Zap,
} from 'lucide-react'

const navItems = [
  { path: '/', label: '仪表盘', icon: LayoutDashboard },
  { path: '/instances', label: '实例管理', icon: Server },
  { path: '/rss', label: 'RSS 管理', icon: Rss },
  { path: '/space-policy', label: '空间策略', icon: HardDrive },
  { path: '/queue-policy', label: '队列策略', icon: ListOrdered },
  { path: '/rate-limit', label: '限速策略', icon: Gauge },
  { path: '/telegram', label: 'Telegram', icon: MessageSquare },
  { path: '/logs', label: '操作日志', icon: ScrollText },
]

export default function Layout({ children }: { children: ReactNode }) {
  const location = useLocation()
  const navigate = useNavigate()

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 shrink-0 flex flex-col border-r"
        style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>
        {/* Logo */}
        <div className="flex items-center gap-3 px-5 py-5 border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)' }}>
            <Zap size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
              AniBT-Speed
            </h1>
            <p className="text-[11px] tracking-wide" style={{ color: 'var(--text-muted)' }}>
              种群加速管理
            </p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-3 px-3 space-y-0.5 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path
            return (
              <button
                key={item.path}
                onClick={() => navigate({ to: item.path })}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 cursor-pointer"
                style={{
                  background: isActive ? 'var(--bg-card)' : 'transparent',
                  color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
                  boxShadow: isActive ? '0 0 0 1px var(--border)' : 'none',
                }}
                onMouseEnter={(e) => {
                  if (!isActive) e.currentTarget.style.background = 'var(--bg-hover)'
                }}
                onMouseLeave={(e) => {
                  if (!isActive) e.currentTarget.style.background = 'transparent'
                }}
              >
                <item.icon size={18} />
                <span>{item.label}</span>
              </button>
            )
          })}
        </nav>

        {/* Footer */}
        <div className="px-5 py-4 border-t text-xs" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
          <div className="flex items-center gap-1">
            <Shield size={12} />
            <span>PeerBanHelper</span>
            <span className="ml-auto w-2 h-2 rounded-full" style={{ background: 'var(--success)' }} />
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-6" style={{ background: 'var(--bg-primary)' }}>
        {children}
      </main>
    </div>
  )
}
