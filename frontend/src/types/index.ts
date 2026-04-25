export interface QBTInstance {
  id: number
  name: string
  url: string
  username: string
  download_path: string
  tag: string
  enabled: boolean
  created_at: string | null
  status?: {
    connected: boolean
    dl_speed?: number
    up_speed?: number
    dl_total?: number
    up_total?: number
    total?: number
    active?: number
    paused?: number
  }
}

export interface RSSFeed {
  id: number
  name: string
  url: string
  instance_id: number
  include_filter: string
  exclude_filter: string
  refresh_interval: number
  max_items_per_check: number
  enabled: boolean
}

export interface SpaceConfig {
  enabled: boolean
  threshold_percent: number
  protect_hours: number
  boundary_hours: number
  max_torrent_size_gb: number
  check_path: string
  check_interval_minutes: number
}

export interface QueueConfig {
  enabled: boolean
  pause_when_no_leechers: boolean
  resume_when_leechers_gt: number
  min_seed_time_hours: number
  exclude_tags: string[]
  keyword_cleanup_enabled: boolean
  keyword_cleanup_hours: number
  keyword_cleanup_keywords: string[]
  keyword_cleanup_max_per_run: number
}

export interface RateLimitConfig {
  enabled: boolean
  seed_only_upload_kbps: number
  active_dl_upload_kbps: number
  active_dl_download_kbps: number
  sliding_window_enabled: boolean
  hourly_limit_gb: number
  daily_limit_gb: number
}

export interface TelegramConfig {
  enabled: boolean
  bot_token: string
  chat_id: string
  notify_new_download: boolean
  notify_completed: boolean
  notify_deleted: boolean
  notify_paused: boolean
  notify_resumed: boolean
  notify_space_alert: boolean
  daily_summary: boolean
  daily_summary_hour: number
}

export interface ActionLogEntry {
  id: number
  timestamp: string
  action: string
  instance_id: number | null
  torrent_name: string
  details: string
}

export interface Torrent {
  hash: string
  name: string
  size: number
  progress: number
  state: string
  ratio: number
  up_speed: number
  dl_speed: number
  num_seeds: number
  num_leechs: number
  added_on: number
  category: string
  tags: string
}
