import type { ReactNode } from 'react'

interface StatusCardProps {
  title: string
  value: string | number
  subtitle?: string
  color?: string
  /** @deprecated kept for backward compat — ignored */
  icon?: ReactNode
  /** @deprecated use color instead */
  accent?: string
}

export default function StatusCard({ title, value, subtitle, color, accent }: StatusCardProps) {
  const tint = color ?? accent

  return (
    <div className="py-4" style={{ borderBottom: '1px solid var(--ctp-surface0)' }}>
      <span
        className="text-[11px] font-medium tracking-widest uppercase block mb-2"
        style={{ color: 'var(--ctp-overlay1)' }}
      >
        {title}
      </span>
      <span
        className="text-2xl font-semibold tracking-tight block"
        style={{ color: tint ?? 'var(--ctp-text)' }}
      >
        {value}
      </span>
      {subtitle && (
        <span
          className="text-xs block mt-1"
          style={{ color: 'var(--ctp-overlay0)' }}
        >
          {subtitle}
        </span>
      )}
    </div>
  )
}
