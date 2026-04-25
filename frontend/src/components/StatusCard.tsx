import type { ReactNode } from 'react'

interface StatusCardProps {
  title: string
  value: string | number
  subtitle?: string
  color?: string
  icon?: ReactNode
  accent?: string
}

export default function StatusCard({ title, value, subtitle, color, accent }: StatusCardProps) {
  const tint = color ?? accent

  return (
    <div className="metric-card">
      <div className="metric-label">{title}</div>
      <div className="metric-value" style={{ color: tint ?? 'var(--text-primary)' }}>{value}</div>
      {subtitle && <div className="metric-subtitle">{subtitle}</div>}
    </div>
  )
}
