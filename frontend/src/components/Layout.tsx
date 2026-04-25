import type { ReactNode } from 'react'
import { useLocation, useNavigate, useRouter } from '@tanstack/react-router'
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
  const router = useRouter()

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark">A</div>
          <div className="brand-title">AniBT-Speed</div>
          <div className="brand-subtitle">SWARM CONTROL</div>
        </div>

        <nav className="nav-list" aria-label="主导航">
          {navItems.map((item) => {
            const active = location.pathname === item.path
            return (
              <button
                key={item.path}
                onClick={() => navigate({ to: item.path })}
                className="nav-item"
                aria-current={active ? 'page' : undefined}
                onMouseEnter={() => {
                  router.preloadRoute({ to: item.path })
                }}
              >
                <item.icon size={18} />
                <span>{item.label}</span>
              </button>
            )
          })}
        </nav>

        <div className="sidebar-footer">
          <div className="status-pill">
            <span className="status-dot" />
            AniBT-Speed
          </div>
          <button
            onClick={() => { clearToken(); navigate({ to: '/login' }) }}
            className="btn btn-ghost"
            style={{ justifyContent: 'flex-start' }}
          >
            <LogOut size={15} />
            退出登录
          </button>
        </div>
      </aside>

      <main className="main-pane" id="main-content">
        <div className="content-frame">
          {children}
        </div>
      </main>
    </div>
  )
}
