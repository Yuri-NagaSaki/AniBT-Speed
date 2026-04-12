import type { ReactNode } from 'react'

interface StatusCardProps {
  title: string
  value: string | number
  subtitle?: string
  icon?: ReactNode
  accent?: string
}

export default function StatusCard({ title, value, subtitle, icon, accent = 'var(--accent)' }: StatusCardProps) {
  return (
    <div
      className="rounded-2xl p-5 transition-all duration-200 hover:translate-y-[-2px]"
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        boxShadow: '0 4px 24px rgba(0,0,0,0.15)',
      }}
    >
      <div className="flex items-start justify-between mb-3">
        <span className="text-xs font-medium tracking-wide uppercase" style={{ color: 'var(--text-muted)' }}>
          {title}
        </span>
        {icon && (
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: `${accent}15`, color: accent }}
          >
            {icon}
          </div>
        )}
      </div>
      <div className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
        {value}
      </div>
      {subtitle && (
        <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
          {subtitle}
        </p>
      )}
    </div>
  )
}
