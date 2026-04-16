const API_BASE = '/api'

const TOKEN_KEY = 'anibt_token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken() {
  const token = localStorage.getItem(TOKEN_KEY)
  if (token) {
    // Revoke token server-side (fire-and-forget)
    fetch(`${API_BASE}/auth/logout`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
    }).catch(() => {})
  }
  localStorage.removeItem(TOKEN_KEY)
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string>),
  }
  const token = getToken()
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  })
  if (res.status === 401) {
    clearToken()
    window.location.href = '/login'
    throw new Error('Session expired')
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || 'Request failed')
  }
  return res.json()
}

// Auth
export const authApi = {
  login: async (password: string) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Login failed' }))
      throw new Error(err.detail || 'Login failed')
    }
    const data = await res.json()
    setToken(data.token)
    return data
  },
}

// Instances
export const instancesApi = {
  list: () => request<any[]>('/instances'),
  create: (data: any) => request('/instances', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: number, data: any) => request(`/instances/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: number) => request(`/instances/${id}`, { method: 'DELETE' }),
  test: (id: number) => request<any>(`/instances/${id}/test`, { method: 'POST' }),
  testConnection: (data: { url: string; username: string; password: string }) =>
    request<any>('/instances/test-connection', { method: 'POST', body: JSON.stringify(data) }),
  torrents: (id: number) => request<any[]>(`/instances/${id}/torrents`),
}

// RSS
export const rssApi = {
  list: () => request<any[]>('/rss'),
  create: (data: any) => request('/rss', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: number, data: any) => request(`/rss/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: number) => request(`/rss/${id}`, { method: 'DELETE' }),
}

// Settings
export const settingsApi = {
  get: (category: string) => request<any>(`/settings/${category}`),
  update: (category: string, config: any) =>
    request(`/settings/${category}`, { method: 'PUT', body: JSON.stringify({ config }) }),
}

// Stats
export const statsApi = {
  logs: (params?: { limit?: number; offset?: number; action?: string }) => {
    const qs = new URLSearchParams()
    if (params?.limit) qs.set('limit', String(params.limit))
    if (params?.offset) qs.set('offset', String(params.offset))
    if (params?.action) qs.set('action', params.action)
    return request<{ total: number; logs: any[] }>(`/stats/logs?${qs}`)
  },
  traffic: (params?: { instance_id?: number; hours?: number }) => {
    const qs = new URLSearchParams()
    if (params?.instance_id) qs.set('instance_id', String(params.instance_id))
    if (params?.hours) qs.set('hours', String(params.hours))
    return request<any[]>(`/stats/traffic?${qs}`)
  },
  summary: () => request<any>('/stats/summary'),
}

// Telegram
export const telegramApi = {
  get: () => request<any>('/telegram'),
  update: (data: any) => request('/telegram', { method: 'PUT', body: JSON.stringify(data) }),
  test: () => request<any>('/telegram/test', { method: 'POST' }),
}
