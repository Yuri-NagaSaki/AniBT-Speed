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

  if (isLoading) return <div style={{ color: 'var(--text-muted)' }}>加载中...</div>

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>{title}</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>{description}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => data && setForm(data)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm cursor-pointer"
            style={{ color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
            <RotateCcw size={14} /> 重置
          </button>
          <button onClick={handleSave}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium text-white cursor-pointer"
            style={{ background: saved ? 'var(--success)' : 'var(--accent)' }}>
            <Save size={14} /> {saved ? '已保存 ✓' : '保存'}
          </button>
        </div>
      </div>

      <div className="rounded-2xl p-6 space-y-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
        {fields.map((field) => (
          <div key={field.key} className="flex items-center justify-between py-2 border-b last:border-0"
            style={{ borderColor: 'var(--border)' }}>
            <div className="flex-1">
              <label className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{field.label}</label>
              {field.help && <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{field.help}</p>}
            </div>
            <div className="ml-4 flex items-center gap-2">
              {field.type === 'toggle' ? (
                <button
                  onClick={() => setForm({ ...form, [field.key]: !form[field.key] })}
                  className="relative w-11 h-6 rounded-full transition-colors cursor-pointer"
                  style={{ background: form[field.key] ? 'var(--accent)' : 'var(--border)' }}>
                  <div className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform"
                    style={{ left: form[field.key] ? '22px' : '2px' }} />
                </button>
              ) : field.type === 'number' ? (
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={form[field.key] ?? ''}
                    onChange={(e) => setForm({ ...form, [field.key]: Number(e.target.value) })}
                    min={field.min}
                    max={field.max}
                    className="w-28 px-3 py-2 rounded-lg text-sm text-right outline-none"
                    style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                  />
                  {field.unit && <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{field.unit}</span>}
                </div>
              ) : (
                <input
                  type="text"
                  value={form[field.key] ?? ''}
                  onChange={(e) => setForm({ ...form, [field.key]: e.target.value })}
                  className="w-64 px-3 py-2 rounded-lg text-sm outline-none"
                  style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                />
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
