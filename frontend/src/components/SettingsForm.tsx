import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { settingsApi } from '../api/client'
import { Save, RotateCcw } from 'lucide-react'

interface FieldDef {
  key: string
  label: string
  type: 'number' | 'text' | 'toggle' | 'tags'
  unit?: string
  help?: string
  min?: number
  max?: number
}

interface SettingsFormProps {
  category: string
  title: string
  description: string
  fields: FieldDef[]
}

export default function SettingsForm({ category, title, description, fields }: SettingsFormProps) {
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['settings', category],
    queryFn: () => settingsApi.get(category),
  })

  const [form, setForm] = useState<Record<string, any>>({})
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (data) setForm(data)
  }, [data])

  const mutation = useMutation({
    mutationFn: (config: any) => settingsApi.update(category, config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', category] })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    },
  })

  function handleSave() {
    mutation.mutate(form)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div
          className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
          style={{ borderColor: 'var(--border)', borderTopColor: 'transparent' }}
        />
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto" style={{ animation: 'fadeIn 0.4s ease-out' }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1
            className="text-2xl font-bold tracking-tight"
            style={{ color: 'var(--text-primary)' }}
          >
            {title}
          </h1>
          <p className="text-sm mt-1.5 font-medium" style={{ color: 'var(--text-secondary)' }}>
            {description}
          </p>
        </div>
        <div className="flex gap-2.5">
          {/* Reset button */}
          <button
            onClick={() => data && setForm(data)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium cursor-pointer transition-all duration-200"
            style={{
              color: 'var(--text-secondary)',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              backdropFilter: 'blur(8px)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--border-strong)'
              e.currentTarget.style.color = 'var(--text-primary)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--border)'
              e.currentTarget.style.color = 'var(--text-secondary)'
            }}
          >
            <RotateCcw size={14} /> 重置
          </button>

          {/* Save button */}
          <button
            onClick={handleSave}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white cursor-pointer transition-all duration-300"
            style={{
              background: saved ? 'var(--success)' : 'var(--gradient-accent)',
              boxShadow: saved
                ? '0 4px 20px var(--success-glow)'
                : '0 4px 20px var(--accent-glow)',
            }}
            onMouseEnter={(e) => {
              if (!saved) e.currentTarget.style.transform = 'translateY(-1px)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)'
            }}
          >
            <Save size={14} /> {saved ? '已保存 ✓' : '保存'}
          </button>
        </div>
      </div>

      {/* Success toast */}
      {saved && (
        <div
          className="fixed top-6 right-6 flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold text-white z-50"
          style={{
            background: 'var(--success)',
            boxShadow: '0 8px 32px rgba(34, 197, 94, 0.3)',
            animation: 'slideUp 0.3s ease-out',
          }}
        >
          <Save size={15} /> 设置已保存
        </div>
      )}

      {/* Settings card */}
      <div
        className="rounded-2xl overflow-hidden"
        style={{
          background: 'var(--bg-card)',
          backdropFilter: 'blur(16px) saturate(1.4)',
          WebkitBackdropFilter: 'blur(16px) saturate(1.4)',
          border: '1px solid var(--border)',
          boxShadow: '0 4px 24px rgba(0, 0, 0, 0.15)',
        }}
      >
        {fields.map((field, i) => (
          <div
            key={field.key}
            className="flex items-center justify-between px-6 py-5 transition-colors duration-200"
            style={{
              borderBottom: i < fields.length - 1 ? '1px solid var(--border)' : 'none',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(39, 39, 42, 0.3)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
            }}
          >
            <div className="flex-1 pr-4">
              <label className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                {field.label}
              </label>
              {field.help && (
                <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                  {field.help}
                </p>
              )}
            </div>

            <div className="ml-4 flex items-center gap-2.5">
              {field.type === 'toggle' ? (
                <button
                  onClick={() => setForm({ ...form, [field.key]: !form[field.key] })}
                  className="relative w-12 h-7 rounded-full transition-all duration-300 cursor-pointer"
                  style={{
                    background: form[field.key]
                      ? 'linear-gradient(135deg, #6366f1, #8b5cf6)'
                      : 'rgba(63, 63, 70, 0.6)',
                    boxShadow: form[field.key]
                      ? '0 0 16px var(--accent-glow), inset 0 1px 2px rgba(255,255,255,0.1)'
                      : 'inset 0 1px 3px rgba(0,0,0,0.3)',
                  }}
                >
                  <div
                    className="absolute top-[3px] w-[22px] h-[22px] rounded-full shadow-lg transition-all duration-300"
                    style={{
                      left: form[field.key] ? '25px' : '3px',
                      background: '#fff',
                      boxShadow: form[field.key]
                        ? '0 2px 8px rgba(99, 102, 241, 0.4)'
                        : '0 2px 4px rgba(0,0,0,0.3)',
                    }}
                  />
                </button>
              ) : field.type === 'number' ? (
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={form[field.key] ?? ''}
                    onChange={(e) => setForm({ ...form, [field.key]: Number(e.target.value) })}
                    min={field.min}
                    max={field.max}
                    className="w-28 px-3 py-2.5 rounded-xl text-sm text-right outline-none transition-all duration-200"
                    style={{
                      background: 'rgba(9, 9, 11, 0.6)',
                      border: '1px solid var(--border)',
                      color: 'var(--text-primary)',
                    }}
                    onFocus={(e) => {
                      e.currentTarget.style.borderColor = 'var(--accent)'
                      e.currentTarget.style.boxShadow = '0 0 0 3px var(--accent-glow)'
                    }}
                    onBlur={(e) => {
                      e.currentTarget.style.borderColor = 'var(--border)'
                      e.currentTarget.style.boxShadow = 'none'
                    }}
                  />
                  {field.unit && (
                    <span
                      className="text-[11px] font-semibold tracking-wide px-2 py-1 rounded-lg"
                      style={{
                        color: 'var(--text-muted)',
                        background: 'var(--bg-elevated)',
                      }}
                    >
                      {field.unit}
                    </span>
                  )}
                </div>
              ) : (
                <input
                  type="text"
                  value={form[field.key] ?? ''}
                  onChange={(e) => setForm({ ...form, [field.key]: e.target.value })}
                  className="w-64 px-3 py-2.5 rounded-xl text-sm outline-none transition-all duration-200"
                  style={{
                    background: 'rgba(9, 9, 11, 0.6)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-primary)',
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = 'var(--accent)'
                    e.currentTarget.style.boxShadow = '0 0 0 3px var(--accent-glow)'
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = 'var(--border)'
                    e.currentTarget.style.boxShadow = 'none'
                  }}
                />
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
