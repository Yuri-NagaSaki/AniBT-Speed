import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { settingsApi } from '../api/client'
import { Save, RotateCcw } from 'lucide-react'
import { Button, Input, PageHeader, Panel, Skeleton, Toggle } from './ui'

interface FieldDef {
  key: string
  label: string
  type: 'number' | 'text' | 'toggle' | 'tags'
  unit?: string
  help?: string
  min?: number
  max?: number
}

type SettingsValue = string | number | boolean | string[] | null | undefined
type SettingsState = Record<string, SettingsValue>

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
    staleTime: 60000,
  })

  const [form, setForm] = useState<SettingsState>({})
  const [saved, setSaved] = useState(false)

  useEffect(() => { if (data) setForm(data) }, [data])

  const mutation = useMutation({
    mutationFn: (config: SettingsState) => settingsApi.update(category, config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', category] })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    },
  })

  if (isLoading) {
    return (
      <div style={{ maxWidth: 760 }}>
        <Skeleton width="40%" height={34} />
        <div style={{ height: 48 }} />
        {Array.from({ length: 5 }).map((_, i) => (
          <div className="setting-row" key={i}>
            <div>
              <Skeleton width="42%" height={14} />
              <div style={{ height: 10 }} />
              <Skeleton width="72%" height={12} />
            </div>
            <Skeleton width={108} height={42} />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 780 }}>
      <PageHeader title={title} description={description} kicker="Policy" />

      <Panel padded>
        {fields.map((field, i) => (
          <div key={field.key} className="setting-row" style={{ borderBottom: i < fields.length - 1 ? undefined : '0' }}>
            <div>
              <div className="field-label" style={{ color: 'var(--text-primary)' }}>{field.label}</div>
              {field.help && <div className="field-help" style={{ marginTop: 7 }}>{field.help}</div>}
            </div>
            <div className="setting-control">
              {field.type === 'toggle' ? (
                <Toggle checked={!!form[field.key]} onCheckedChange={(checked) => setForm({ ...form, [field.key]: checked })} label={field.label} />
              ) : field.type === 'number' ? (
                <>
                  <Input
                    type="number"
                    value={formatInputValue(form[field.key])}
                    onChange={(e) => setForm({ ...form, [field.key]: Number(e.target.value) })}
                    min={field.min} max={field.max}
                    className="mono"
                    style={{ textAlign: 'right' }}
                  />
                  {field.unit && <span style={{ fontSize: 13, color: 'var(--text-muted)', minWidth: 28 }}>{field.unit}</span>}
                </>
              ) : field.type === 'tags' ? (
                <Input
                  type="text"
                  value={formatTags(form[field.key])}
                  onChange={(e) => setForm({ ...form, [field.key]: parseTags(e.target.value) })}
                  placeholder="Dynamis One, Example"
                />
              ) : (
                <Input
                  type="text"
                  value={formatInputValue(form[field.key])}
                  onChange={(e) => setForm({ ...form, [field.key]: e.target.value })}
                />
              )}
            </div>
          </div>
        ))}
      </Panel>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 28 }}>
        <Button
          onClick={() => mutation.mutate(form)}
          disabled={mutation.isPending}
          style={{ background: saved ? 'var(--ctp-green)' : undefined }}
        >
          <Save size={15} /> {saved ? '已保存 ✓' : '保存设置'}
        </Button>
        <Button
          variant="secondary"
          onClick={() => data && setForm(data)}
        >
          <RotateCcw size={15} /> 重置
        </Button>
      </div>
    </div>
  )
}

function formatTags(value: SettingsValue): string {
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'string') return value
  return ''
}

function formatInputValue(value: SettingsValue): string | number {
  if (typeof value === 'number' || typeof value === 'string') return value
  return ''
}

function parseTags(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}
