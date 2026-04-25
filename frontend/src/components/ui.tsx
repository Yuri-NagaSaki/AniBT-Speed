import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'

export function PageHeader({
  title,
  description,
  kicker = 'AniBT-Speed',
  actions,
}: {
  title: string
  description?: string
  kicker?: string
  actions?: ReactNode
}) {
  return (
    <header className="page-header">
      <div>
        <div className="page-kicker">{kicker}</div>
        <h1 className="page-title">{title}</h1>
        {description && <p className="page-description">{description}</p>}
      </div>
      {actions && <div>{actions}</div>}
    </header>
  )
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="section-label">{children}</div>
}

export function Panel({ children, padded = false }: { children: ReactNode; padded?: boolean }) {
  return <div className={`panel${padded ? ' padded' : ''}`}>{children}</div>
}

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' }) {
  return <button className={`btn btn-${variant} ${className}`} {...props} />
}

export function IconButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <Button variant="ghost" {...props} />
}

export function Field({
  label,
  help,
  children,
}: {
  label: string
  help?: string
  children: ReactNode
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {help && <span className="field-help">{help}</span>}
    </label>
  )
}

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`input ${className}`} {...props} />
}

export function Select({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`input ${className}`} {...props} />
}

export function Toggle({
  checked,
  onCheckedChange,
  label,
}: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  label?: string
}) {
  return (
    <button
      type="button"
      className="switch"
      data-state={checked ? 'on' : 'off'}
      aria-pressed={checked}
      aria-label={label}
      onClick={() => onCheckedChange(!checked)}
    >
      <span className="switch-thumb" />
    </button>
  )
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="empty-state">
      <p style={{ color: 'var(--text-secondary)', fontWeight: 620 }}>{title}</p>
      {description && <p style={{ marginTop: 8, fontSize: 12 }}>{description}</p>}
    </div>
  )
}

export function Skeleton({ width = '100%', height = 16 }: { width?: string | number; height?: string | number }) {
  return <div className="skeleton" style={{ width, height }} />
}

export function Toast({
  children,
  tone = 'default',
  onClick,
}: {
  children: ReactNode
  tone?: 'default' | 'success' | 'error'
  onClick?: () => void
}) {
  const color = tone === 'success' ? 'var(--ctp-green)' : tone === 'error' ? 'var(--ctp-red)' : 'var(--text-primary)'
  return (
    <div className="toast" onClick={onClick} style={{ color, cursor: onClick ? 'pointer' : 'default' }}>
      {children}
    </div>
  )
}
