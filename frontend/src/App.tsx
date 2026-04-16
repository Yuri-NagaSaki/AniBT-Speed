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
import { instancesApi, statsApi, rssApi, settingsApi, telegramApi } from './api/client'
import { queryClient } from './main'
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

const indexRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/',
  component: Dashboard,
  loader: () => {
    queryClient.prefetchQuery({ queryKey: ['instances'], queryFn: instancesApi.list, staleTime: 5000 })
    queryClient.prefetchQuery({ queryKey: ['traffic'], queryFn: () => statsApi.traffic(), staleTime: 30000 })
    queryClient.prefetchQuery({ queryKey: ['stats-summary'], queryFn: statsApi.summary, staleTime: 5000 })
  },
})
const instancesRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/instances',
  component: Instances,
  loader: () => {
    queryClient.prefetchQuery({ queryKey: ['instances'], queryFn: instancesApi.list, staleTime: 5000 })
  },
})
const rssRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/rss',
  component: RSSManager,
  loader: () => {
    queryClient.prefetchQuery({ queryKey: ['rss'], queryFn: rssApi.list, staleTime: 30000 })
    queryClient.prefetchQuery({ queryKey: ['instances'], queryFn: instancesApi.list, staleTime: 5000 })
  },
})
const spaceRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/space-policy',
  component: SpacePolicy,
  loader: () => {
    queryClient.prefetchQuery({ queryKey: ['settings', 'space'], queryFn: () => settingsApi.get('space'), staleTime: 60000 })
  },
})
const queueRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/queue-policy',
  component: QueuePolicy,
  loader: () => {
    queryClient.prefetchQuery({ queryKey: ['settings', 'queue'], queryFn: () => settingsApi.get('queue'), staleTime: 60000 })
  },
})
const rateRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/rate-limit',
  component: RateLimit,
  loader: () => {
    queryClient.prefetchQuery({ queryKey: ['settings', 'rate_limit'], queryFn: () => settingsApi.get('rate_limit'), staleTime: 60000 })
  },
})
const telegramRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/telegram',
  component: Telegram,
  loader: () => {
    queryClient.prefetchQuery({ queryKey: ['telegram'], queryFn: telegramApi.get, staleTime: 60000 })
  },
})
const logsRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/logs',
  component: Logs,
  loader: () => {
    queryClient.prefetchQuery({ queryKey: ['logs', undefined, 0], queryFn: () => statsApi.logs({ limit: 30, offset: 0 }), staleTime: 10000 })
  },
})

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

const router = createRouter({ routeTree, defaultPreload: 'intent' })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

export default function App() {
  return <RouterProvider router={router} />
}
