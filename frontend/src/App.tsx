import {
  createRouter,
  createRootRoute,
  createRoute,
  RouterProvider,
  Outlet,
} from '@tanstack/react-router'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Instances from './pages/Instances'
import RSSManager from './pages/RSSManager'
import SpacePolicy from './pages/SpacePolicy'
import QueuePolicy from './pages/QueuePolicy'
import RateLimit from './pages/RateLimit'
import Telegram from './pages/Telegram'
import Logs from './pages/Logs'

const rootRoute = createRootRoute({
  component: () => (
    <Layout>
      <Outlet />
    </Layout>
  ),
})

const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: Dashboard })
const instancesRoute = createRoute({ getParentRoute: () => rootRoute, path: '/instances', component: Instances })
const rssRoute = createRoute({ getParentRoute: () => rootRoute, path: '/rss', component: RSSManager })
const spaceRoute = createRoute({ getParentRoute: () => rootRoute, path: '/space-policy', component: SpacePolicy })
const queueRoute = createRoute({ getParentRoute: () => rootRoute, path: '/queue-policy', component: QueuePolicy })
const rateRoute = createRoute({ getParentRoute: () => rootRoute, path: '/rate-limit', component: RateLimit })
const telegramRoute = createRoute({ getParentRoute: () => rootRoute, path: '/telegram', component: Telegram })
const logsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/logs', component: Logs })

const routeTree = rootRoute.addChildren([
  indexRoute,
  instancesRoute,
  rssRoute,
  spaceRoute,
  queueRoute,
  rateRoute,
  telegramRoute,
  logsRoute,
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
