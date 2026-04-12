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
      className="group relative rounded-2xl p-5 transition-all duration-300 ease-out hover:translate-y-[-3px]"
      style={{
        background: 'var(--bg-card)',
        backdropFilter: 'blur(16px) saturate(1.4)',
        WebkitBackdropFilter: 'blur(16px) saturate(1.4)',
        border: '1px solid var(--border)',
        boxShadow: '0 4px 24px rgba(0, 0, 0, 0.2), 0 1px 2px rgba(0, 0, 0, 0.1)',
        animation: 'slideUp 0.4s ease-out both',
        overflow: 'hidden',
      }}
    >
      {/* Left accent bar */}
      <div
        className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-2xl transition-all duration-300 group-hover:w-[4px]"
        style={{
          background: `linear-gradient(180deg, ${accent}, ${accent}88)`,
          boxShadow: `0 0 12px ${accent}40`,
        }}
      />

      {/* Hover glow overlay */}
      <div
        className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{
          background: `radial-gradient(ellipse at 70% 20%, ${accent}08, transparent 70%)`,
        }}
      />

      <div className="relative flex items-start justify-between mb-3">
        <span
          className="text-[11px] font-semibold tracking-widest uppercase"
          style={{ color: 'var(--text-muted)' }}
        >
          {title}
        </span>
        {icon && (
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-300 group-hover:scale-110"
            style={{
              background: `linear-gradient(135deg, ${accent}18, ${accent}08)`,
              color: accent,
              border: `1px solid ${accent}20`,
              boxShadow: `0 0 16px ${accent}15`,
            }}
          >
            {icon}
          </div>
        )}
      </div>

      <div
        className="relative text-[28px] font-bold tracking-tight leading-none"
        style={{ color: 'var(--text-primary)' }}
      >
        {value}
      </div>

      {subtitle && (
        <p className="text-xs mt-2 font-medium" style={{ color: 'var(--text-secondary)' }}>
          {subtitle}
        </p>
      )}
    </div>
  )
}
