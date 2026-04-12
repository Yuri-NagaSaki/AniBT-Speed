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

  useEffect(() => { if (data) setForm(data) }, [data])

  const mutation = useMutation({
    mutationFn: (config: any) => settingsApi.update(category, config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', category] })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    },
  })

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}>
        <div style={{
          width: 28, height: 28, borderRadius: '50%',
          border: '2px solid var(--ctp-surface2)',
          borderTopColor: 'transparent',
          animation: 'spin 0.8s linear infinite',
        }} />
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 720, animation: 'fadeIn 0.35s ease-out' }}>
      {/* Header */}
      <div style={{ marginBottom: 48 }}>
        <h1 style={{
          fontSize: 22,
          fontWeight: 600,
          color: 'var(--ctp-text)',
          letterSpacing: '-0.02em',
          lineHeight: 1.3,
        }}>
          {title}
        </h1>
        <p style={{ fontSize: 14, color: 'var(--ctp-subtext0)', marginTop: 8, lineHeight: 1.6 }}>
          {description}
        </p>
      </div>

      {/* Settings rows */}
      <div style={{ marginBottom: 48 }}>
        {fields.map((field, i) => (
          <div key={field.key} style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '24px 0',
            borderBottom: i < fields.length - 1 ? '1px solid var(--ctp-surface0)' : 'none',
          }}>
            <div style={{ flex: 1, paddingRight: 40 }}>
              <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ctp-text)', lineHeight: 1.4 }}>
                {field.label}
              </div>
              {field.help && (
                <div style={{ fontSize: 13, color: 'var(--ctp-overlay0)', marginTop: 6, lineHeight: 1.6 }}>
                  {field.help}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
              {field.type === 'toggle' ? (
                <button
                  type="button"
                  onClick={() => setForm({ ...form, [field.key]: !form[field.key] })}
                  style={{
                    position: 'relative',
                    width: 44, height: 24,
                    borderRadius: 12, border: 'none', cursor: 'pointer',
                    background: form[field.key] ? 'var(--ctp-mauve)' : 'var(--ctp-surface1)',
                    transition: 'background 0.2s ease',
                  }}
                >
                  <div style={{
                    position: 'absolute', top: 2,
                    left: form[field.key] ? 22 : 2,
                    width: 20, height: 20, borderRadius: 10,
                    background: form[field.key] ? 'var(--ctp-crust)' : 'var(--ctp-overlay0)',
                    transition: 'all 0.2s ease',
                  }} />
                </button>
              ) : field.type === 'number' ? (
                <>
                  <input
                    type="number"
                    value={form[field.key] ?? ''}
                    onChange={(e) => setForm({ ...form, [field.key]: Number(e.target.value) })}
                    min={field.min} max={field.max}
                    style={{
                      width: 100, padding: '10px 14px',
                      borderRadius: 8, border: '1px solid var(--ctp-surface1)',
                      background: 'var(--ctp-surface0)', color: 'var(--ctp-text)',
                      fontSize: 14, fontFamily: "'Geist Mono', monospace",
                      textAlign: 'right' as const, outline: 'none',
                      transition: 'border-color 0.15s ease',
                    }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--ctp-mauve)' }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--ctp-surface1)' }}
                  />
                  {field.unit && (
                    <span style={{ fontSize: 13, color: 'var(--ctp-overlay0)', minWidth: 28 }}>{field.unit}</span>
                  )}
                </>
              ) : (
                <input
                  type="text"
                  value={form[field.key] ?? ''}
                  onChange={(e) => setForm({ ...form, [field.key]: e.target.value })}
                  style={{
                    width: 240, padding: '10px 14px',
                    borderRadius: 8, border: '1px solid var(--ctp-surface1)',
                    background: 'var(--ctp-surface0)', color: 'var(--ctp-text)',
                    fontSize: 14, outline: 'none',
                    transition: 'border-color 0.15s ease',
                  }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--ctp-mauve)' }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--ctp-surface1)' }}
                />
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <button
          onClick={() => mutation.mutate(form)}
          disabled={mutation.isPending}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '12px 24px', borderRadius: 10,
            border: 'none', cursor: 'pointer',
            fontSize: 14, fontWeight: 500, fontFamily: 'inherit',
            background: saved ? 'var(--ctp-green)' : 'var(--ctp-mauve)',
            color: 'var(--ctp-crust)',
            transition: 'all 0.15s ease',
            opacity: mutation.isPending ? 0.6 : 1,
          }}
        >
          <Save size={15} /> {saved ? '已保存 ✓' : '保存设置'}
        </button>
        <button
          onClick={() => data && setForm(data)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '12px 20px', borderRadius: 10,
            border: 'none', cursor: 'pointer',
            fontSize: 14, fontFamily: 'inherit',
            background: 'none', color: 'var(--ctp-subtext0)',
            transition: 'color 0.15s ease',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--ctp-text)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--ctp-subtext0)' }}
        >
          <RotateCcw size={15} /> 重置
        </button>
      </div>
    </div>
  )
}
