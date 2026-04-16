import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { mediaInfoApi } from '../api/client'
import {
  RefreshCw, Play, CheckCircle, AlertCircle, Clock,
  ChevronLeft, ChevronRight, FileVideo,
} from 'lucide-react'

const statusColors = {
  sent: 'var(--ctp-green)',
  error: 'var(--ctp-red)',
  pending: 'var(--ctp-yellow)',
}

export default function MediaInfo() {
  const [page, setPage] = useState(0)
  const limit = 30
  const queryClient = useQueryClient()

  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: ['mediainfo-status'],
    queryFn: () => mediaInfoApi.status(),
    refetchInterval: 30000,
    staleTime: 15000,
  })

  const { data: records, isLoading: recordsLoading } = useQuery({
    queryKey: ['mediainfo-records', page],
    queryFn: () => mediaInfoApi.records({ limit, offset: page * limit }),
    staleTime: 15000,
  })

  const triggerMutation = useMutation({
    mutationFn: () => mediaInfoApi.trigger(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mediainfo-status'] })
      queryClient.invalidateQueries({ queryKey: ['mediainfo-records'] })
    },
  })

  return (
    <div style={{ animation: 'fadeIn 0.3s ease-out' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 48 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{
            width: 48, height: 48, borderRadius: 16,
            background: 'linear-gradient(135deg, var(--ctp-blue), var(--ctp-sapphire))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <FileVideo size={24} color="var(--ctp-base)" />
          </div>
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 700, color: 'var(--ctp-text)', margin: 0 }}>
              MediaInfo
            </h1>
            <p style={{ fontSize: 14, color: 'var(--ctp-subtext0)', margin: 0 }}>
              查看已完成种子的媒体信息推送状态
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => triggerMutation.mutate()}
          disabled={triggerMutation.isPending}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '10px 20px', borderRadius: 12,
            background: 'var(--ctp-blue)',
            color: 'var(--ctp-base)',
            border: 'none', cursor: 'pointer',
            fontSize: 14, fontWeight: 600,
            opacity: triggerMutation.isPending ? 0.6 : 1,
            transition: 'opacity 0.2s',
          }}
        >
          {triggerMutation.isPending ? (
            <RefreshCw size={16} style={{ animation: 'spin 1s linear infinite' }} />
          ) : (
            <Play size={16} />
          )}
          {triggerMutation.isPending ? '同步中...' : '同步 Citrus 状态'}
        </button>
      </div>

      {/* Status cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 32 }}>
        <StatusCard
          label="总计"
          value={status?.total ?? 0}
          icon={<FileVideo size={20} />}
          color="var(--ctp-blue)"
          loading={statusLoading}
        />
        <StatusCard
          label="已推送"
          value={status?.sent_to_citrus ?? 0}
          icon={<CheckCircle size={20} />}
          color="var(--ctp-green)"
          loading={statusLoading}
        />
        <StatusCard
          label="待处理"
          value={status?.pending ?? 0}
          icon={<Clock size={20} />}
          color="var(--ctp-yellow)"
          loading={statusLoading}
        />
        <StatusCard
          label="错误"
          value={status?.errors ?? 0}
          icon={<AlertCircle size={20} />}
          color="var(--ctp-red)"
          loading={statusLoading}
        />
      </div>

      {/* Trigger result toast */}
      {triggerMutation.isSuccess && (
        <div style={{
          padding: '12px 16px', borderRadius: 12, marginBottom: 16,
          background: 'rgba(166, 218, 149, 0.1)', border: '1px solid rgba(166, 218, 149, 0.3)',
          color: 'var(--ctp-green)', fontSize: 14,
        }}>
          ✅ 状态同步完成{triggerMutation.data?.message ? ` — ${triggerMutation.data.message}` : ''}
        </div>
      )}
      {triggerMutation.isError && (
        <div style={{
          padding: '12px 16px', borderRadius: 12, marginBottom: 16,
          background: 'rgba(237, 135, 150, 0.1)', border: '1px solid rgba(237, 135, 150, 0.3)',
          color: 'var(--ctp-red)', fontSize: 14,
        }}>
          ❌ 触发失败: {(triggerMutation.error as Error).message}
        </div>
      )}

      {/* Records table */}
      <div style={{
        background: 'var(--ctp-mantle)', borderRadius: 20,
        border: '1px solid var(--ctp-surface0)', overflow: 'hidden',
      }}>
        <div style={{
          padding: '20px 24px',
          borderBottom: '1px solid var(--ctp-surface0)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--ctp-text)', margin: 0 }}>
            处理记录
          </h2>
          <button
            type="button"
            onClick={() => {
              queryClient.invalidateQueries({ queryKey: ['mediainfo-records'] })
              queryClient.invalidateQueries({ queryKey: ['mediainfo-status'] })
            }}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 12px', borderRadius: 8,
              background: 'var(--ctp-surface0)',
              color: 'var(--ctp-subtext0)',
              border: 'none', cursor: 'pointer', fontSize: 13,
            }}
          >
            <RefreshCw size={14} /> 刷新
          </button>
        </div>

        {recordsLoading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--ctp-subtext0)' }}>
            加载中...
          </div>
        ) : !records || records.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--ctp-subtext0)' }}>
            暂无记录。当种子下载完成后，系统将自动生成 MediaInfo。
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--ctp-surface0)' }}>
                  {['状态', 'Release ID', '种子 Hash', '文件路径', '错误信息', '时间'].map(h => (
                    <th key={h} style={{
                      padding: '12px 16px', textAlign: 'left',
                      fontSize: 12, fontWeight: 600,
                      color: 'var(--ctp-subtext0)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                    }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {records.map((record: any) => (
                  <tr
                    key={record.id}
                    style={{
                      borderBottom: '1px solid var(--ctp-surface0)',
                      transition: 'background 0.2s',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--ctp-surface0)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <td style={{ padding: '12px 16px' }}>
                      <RecordStatus record={record} />
                    </td>
                    <td style={{
                      padding: '12px 16px', fontSize: 13,
                      color: record.release_id ? 'var(--ctp-blue)' : 'var(--ctp-subtext0)',
                      fontFamily: 'monospace',
                    }}>
                      {record.release_id || '—'}
                    </td>
                    <td style={{
                      padding: '12px 16px', fontSize: 12,
                      color: 'var(--ctp-subtext1)',
                      fontFamily: 'monospace',
                      maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {record.torrent_hash?.slice(0, 16)}...
                    </td>
                    <td style={{
                      padding: '12px 16px', fontSize: 12,
                      color: 'var(--ctp-subtext1)',
                      maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {record.file_path ? record.file_path.split('/').pop() : '—'}
                    </td>
                    <td style={{
                      padding: '12px 16px', fontSize: 12,
                      color: record.error_message ? 'var(--ctp-red)' : 'var(--ctp-subtext0)',
                      maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {record.error_message || '—'}
                    </td>
                    <td style={{
                      padding: '12px 16px', fontSize: 12,
                      color: 'var(--ctp-subtext0)',
                      whiteSpace: 'nowrap',
                    }}>
                      {record.created_at ? new Date(record.created_at).toLocaleString('zh-CN') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {records && records.length >= limit && (
          <div style={{
            padding: '12px 24px',
            borderTop: '1px solid var(--ctp-surface0)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16,
          }}>
            <button
              type="button"
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '6px 12px', borderRadius: 8,
                background: page === 0 ? 'var(--ctp-surface0)' : 'var(--ctp-surface1)',
                color: page === 0 ? 'var(--ctp-subtext0)' : 'var(--ctp-text)',
                border: 'none', cursor: page === 0 ? 'default' : 'pointer',
                fontSize: 13, opacity: page === 0 ? 0.5 : 1,
              }}
            >
              <ChevronLeft size={14} /> 上一页
            </button>
            <span style={{ fontSize: 13, color: 'var(--ctp-subtext0)' }}>
              第 {page + 1} 页
            </span>
            <button
              type="button"
              onClick={() => setPage(p => p + 1)}
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '6px 12px', borderRadius: 8,
                background: 'var(--ctp-surface1)',
                color: 'var(--ctp-text)',
                border: 'none', cursor: 'pointer', fontSize: 13,
              }}
            >
              下一页 <ChevronRight size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function StatusCard({
  label, value, icon, color, loading,
}: {
  label: string; value: number; icon: React.ReactNode; color: string; loading: boolean;
}) {
  return (
    <div style={{
      background: 'var(--ctp-mantle)', borderRadius: 16,
      border: '1px solid var(--ctp-surface0)',
      padding: '20px 24px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <div style={{ color }}>{icon}</div>
        <span style={{ fontSize: 13, color: 'var(--ctp-subtext0)', fontWeight: 500 }}>{label}</span>
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--ctp-text)' }}>
        {loading ? '...' : value}
      </div>
    </div>
  )
}

function RecordStatus({ record }: { record: any }) {
  if (record.sent_to_citrus) {
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '3px 10px', borderRadius: 8,
        background: `color-mix(in srgb, ${statusColors.sent} 15%, transparent)`,
        color: statusColors.sent,
        fontSize: 12, fontWeight: 600,
      }}>
        <CheckCircle size={12} /> 已推送
      </span>
    )
  }
  if (record.error_message) {
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '3px 10px', borderRadius: 8,
        background: `color-mix(in srgb, ${statusColors.error} 15%, transparent)`,
        color: statusColors.error,
        fontSize: 12, fontWeight: 600,
      }}>
        <AlertCircle size={12} /> 错误
      </span>
    )
  }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '3px 10px', borderRadius: 8,
      background: `color-mix(in srgb, ${statusColors.pending} 15%, transparent)`,
      color: statusColors.pending,
      fontSize: 12, fontWeight: 600,
    }}>
      <Clock size={12} /> 待处理
    </span>
  )
}
