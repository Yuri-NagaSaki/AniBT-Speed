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
    <div style={{ padding: '24px 0' }}>
      <div style={{
        fontSize: 11,
        fontWeight: 500,
        textTransform: 'uppercase' as const,
        letterSpacing: '0.1em',
        color: 'var(--ctp-overlay1)',
        marginBottom: 12,
      }}>
        {title}
      </div>
      <div style={{
        fontSize: 28,
        fontWeight: 600,
        letterSpacing: '-0.03em',
        lineHeight: 1.2,
        color: tint ?? 'var(--ctp-text)',
      }}>
        {value}
      </div>
      {subtitle && (
        <div style={{
          fontSize: 12,
          color: 'var(--ctp-overlay0)',
          marginTop: 8,
        }}>
          {subtitle}
        </div>
      )}
    </div>
  )
}
