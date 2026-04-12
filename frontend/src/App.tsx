import {
  createRouter,
  createRootRoute,
  createRoute,
  RouterProvider,
  Outlet,
} from '@tanstack/react-router'
import type { ReactNode } from 'react'
import Layout from './components/Layout'
import Login from './pages/Login'
import { getToken } from './api/client'
import Dashboard from './pages/Dashboard'
import Instances from './pages/Instances'
import RSSManager from './pages/RSSManager'
import SpacePolicy from './pages/SpacePolicy'
import QueuePolicy from './pages/QueuePolicy'
import RateLimit from './pages/RateLimit'
import Telegram from './pages/Telegram'
import Logs from './pages/Logs'

function AuthGuard({ children }: { children: ReactNode }) {
  if (!getToken()) {
    window.location.href = '/login'
    return null
  }
  return <>{children}</>
}

const rootRoute = createRootRoute({
  component: () => <Outlet />,
})

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: Login,
})

const layoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'authenticated',
  component: () => (
    <AuthGuard>
      <Layout>
        <Outlet />
      </Layout>
    </AuthGuard>
  ),
})

const indexRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/', component: Dashboard })
const instancesRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/instances', component: Instances })
const rssRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/rss', component: RSSManager })
const spaceRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/space-policy', component: SpacePolicy })
const queueRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/queue-policy', component: QueuePolicy })
const rateRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/rate-limit', component: RateLimit })
const telegramRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/telegram', component: Telegram })
const logsRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/logs', component: Logs })

const routeTree = rootRoute.addChildren([
  loginRoute,
  layoutRoute.addChildren([
    indexRoute,
    instancesRoute,
    rssRoute,
    spaceRoute,
    queueRoute,
    rateRoute,
    telegramRoute,
    logsRoute,
  ]),
])

const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

export default function App() {
  return <RouterProvider router={router} />
}
