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
          className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin"
          style={{ borderColor: 'var(--ctp-surface2)', borderTopColor: 'transparent' }}
        />
      </div>
    )
  }

  return (
    <div className="max-w-3xl" style={{ animation: 'fadeIn 0.3s ease-out' }}>
      {/* Header */}
      <div className="mb-8">
        <h1
          className="text-lg font-medium tracking-tight"
          style={{ color: 'var(--ctp-text)' }}
        >
          {title}
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--ctp-subtext0)' }}>
          {description}
        </p>
      </div>

      {/* Settings rows */}
      <div className="mb-8">
        {fields.map((field, i) => (
          <div
            key={field.key}
            className="flex items-center justify-between py-4"
            style={{
              borderBottom: i < fields.length - 1 ? '1px solid var(--ctp-surface0)' : 'none',
            }}
          >
            <div className="flex-1 pr-6">
              <label className="text-sm font-medium" style={{ color: 'var(--ctp-text)' }}>
                {field.label}
              </label>
              {field.help && (
                <p className="text-xs mt-0.5 leading-relaxed" style={{ color: 'var(--ctp-overlay0)' }}>
                  {field.help}
                </p>
              )}
            </div>

            <div className="ml-4 flex items-center gap-2">
              {field.type === 'toggle' ? (
                <button
                  onClick={() => setForm({ ...form, [field.key]: !form[field.key] })}
                  className="relative w-10 h-[22px] rounded-full transition-colors duration-200 cursor-pointer"
                  style={{
                    background: form[field.key]
                      ? 'var(--ctp-mauve)'
                      : 'var(--ctp-surface1)',
                  }}
                >
                  <div
                    className="absolute top-[2px] w-[18px] h-[18px] rounded-full transition-all duration-200"
                    style={{
                      left: form[field.key] ? '20px' : '2px',
                      background: form[field.key] ? 'var(--ctp-crust)' : 'var(--ctp-overlay0)',
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
                    className="w-24 px-3 py-2 rounded-lg text-sm text-right outline-none transition-colors duration-150"
                    style={{
                      background: 'var(--ctp-surface0)',
                      border: '1px solid var(--ctp-surface1)',
                      color: 'var(--ctp-text)',
                    }}
                    onFocus={(e) => {
                      e.currentTarget.style.borderColor = 'var(--ctp-mauve)'
                    }}
                    onBlur={(e) => {
                      e.currentTarget.style.borderColor = 'var(--ctp-surface1)'
                    }}
                  />
                  {field.unit && (
                    <span
                      className="text-xs"
                      style={{ color: 'var(--ctp-overlay0)' }}
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
                  className="w-56 px-3 py-2 rounded-lg text-sm outline-none transition-colors duration-150"
                  style={{
                    background: 'var(--ctp-surface0)',
                    border: '1px solid var(--ctp-surface1)',
                    color: 'var(--ctp-text)',
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = 'var(--ctp-mauve)'
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = 'var(--ctp-surface1)'
                  }}
                />
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium cursor-pointer transition-colors duration-150"
          style={{
            background: saved ? 'var(--ctp-green)' : 'var(--ctp-mauve)',
            color: 'var(--ctp-crust)',
          }}
          onMouseEnter={(e) => {
            if (!saved) e.currentTarget.style.opacity = '0.85'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.opacity = '1'
          }}
        >
          <Save size={14} /> {saved ? '已保存 ✓' : '保存'}
        </button>

        <button
          onClick={() => data && setForm(data)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm cursor-pointer transition-colors duration-150"
          style={{ color: 'var(--ctp-subtext0)' }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = 'var(--ctp-text)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'var(--ctp-subtext0)'
          }}
        >
          <RotateCcw size={14} /> 重置
        </button>

        {saved && (
          <span className="text-sm ml-2" style={{ color: 'var(--ctp-green)' }}>
            设置已保存
          </span>
        )}
      </div>
    </div>
  )
}
