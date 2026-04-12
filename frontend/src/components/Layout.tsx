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
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--bg-primary)' }}>
      {/* Sidebar */}
      <aside
        className="w-[260px] shrink-0 flex flex-col border-r"
        style={{
          background: 'var(--bg-secondary)',
          borderColor: 'var(--border)',
        }}
      >
        {/* Logo header with gradient */}
        <div
          className="relative px-5 py-5 border-b overflow-hidden"
          style={{ borderColor: 'var(--border)' }}
        >
          {/* Animated gradient background */}
          <div
            className="absolute inset-0 opacity-40"
            style={{
              background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.12), rgba(139, 92, 246, 0.08), transparent)',
            }}
          />
          <div className="relative flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
              style={{
                background: 'var(--gradient-accent)',
                boxShadow: '0 4px 16px rgba(99, 102, 241, 0.3), 0 0 24px rgba(139, 92, 246, 0.15)',
              }}
            >
              <Zap size={20} className="text-white" />
            </div>
            <div>
              <h1
                className="text-[15px] font-bold tracking-tight"
                style={{ color: 'var(--text-primary)' }}
              >
                AniBT-Speed
              </h1>
              <p
                className="text-[11px] font-medium tracking-wide"
                style={{ color: 'var(--text-muted)' }}
              >
                种群加速管理
              </p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-4 px-3 space-y-0.5 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path
            return (
              <button
                key={item.path}
                onClick={() => navigate({ to: item.path })}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-all duration-200 cursor-pointer relative"
                style={{
                  background: isActive
                    ? 'linear-gradient(135deg, rgba(99, 102, 241, 0.15), rgba(139, 92, 246, 0.08))'
                    : 'transparent',
                  color: isActive ? '#a5b4fc' : 'var(--text-secondary)',
                  boxShadow: isActive
                    ? 'inset 0 0 0 1px rgba(99, 102, 241, 0.2), 0 0 20px rgba(99, 102, 241, 0.06)'
                    : 'none',
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.background = 'var(--bg-hover)'
                    e.currentTarget.style.color = 'var(--text-primary)'
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.background = 'transparent'
                    e.currentTarget.style.color = 'var(--text-secondary)'
                  }
                }}
              >
                {/* Active glow indicator */}
                {isActive && (
                  <div
                    className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full"
                    style={{
                      background: 'var(--gradient-accent)',
                      boxShadow: '0 0 10px var(--accent-glow)',
                    }}
                  />
                )}
                <item.icon size={17} style={{ opacity: isActive ? 1 : 0.7 }} />
                <span>{item.label}</span>
              </button>
            )
          })}
        </nav>

        {/* Footer — PBH status */}
        <div
          className="px-5 py-4 border-t"
          style={{ borderColor: 'var(--border)' }}
        >
          <div className="flex items-center gap-2 text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
            <Shield size={13} style={{ opacity: 0.7 }} />
            <span>PeerBanHelper</span>
            <div className="ml-auto flex items-center gap-1.5">
              <span className="text-[10px]" style={{ color: 'var(--success)' }}>在线</span>
              <span
                className="w-2 h-2 rounded-full"
                style={{
                  background: 'var(--success)',
                  boxShadow: '0 0 8px var(--success-glow)',
                  animation: 'dotPulse 2s ease-in-out infinite',
                }}
              />
            </div>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto relative" style={{ background: 'var(--bg-primary)' }}>
        {/* Top gradient depth effect */}
        <div
          className="pointer-events-none absolute top-0 left-0 right-0 h-32 z-10"
          style={{
            background: 'linear-gradient(180deg, rgba(99, 102, 241, 0.03) 0%, transparent 100%)',
          }}
        />
        <div className="relative z-20 p-7">
          {children}
        </div>
      </main>
    </div>
  )
}
