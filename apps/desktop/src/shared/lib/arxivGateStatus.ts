/** Host API diagnostics only: no request URLs, tokens or remote bodies. */
export type ArxivGateStatus = { code: string; phase: string; attempts_started: number;
  http_status?: number | null; retry_after_seconds?: number | null; cooldown_until?: string | null };
const codes = new Set(['queue_full','queue_timeout','request_timeout','connection_failed','dns_failed','http_error',
  'total_timeout','cancelled','rate_limited','cooldown','invalid_target','response_size_limit','invalid_redirect',
  'redirect_limit','state_storage_error','response_body_failed','invalid_encoding','client_failed','request_failed','blocked_address']);
export function arxivGateStatus(value: unknown): ArxivGateStatus | undefined {
  if (typeof value === 'string') {
    if (value.length > 8192) return;
    try { return arxivGateStatus(JSON.parse(value)); } catch { return; }
  }
  if (!value || typeof value !== 'object') return;
  const envelope = value as Record<string, unknown>, raw = envelope.arxiv_gate ?? envelope.gate_error ?? envelope;
  if (!raw || typeof raw !== 'object') return;
  const row = raw as Record<string, unknown>;
  if (!codes.has(String(row.code)) || !['queue','request','task','cooldown'].includes(String(row.phase))
      || !Number.isSafeInteger(row.attempts_started) || Number(row.attempts_started) < 0 || Number(row.attempts_started) > 12) return;
  const seconds = row.retry_after_seconds, until = row.cooldown_until;
  if (seconds != null && (!Number.isSafeInteger(seconds) || Number(seconds) < 0 || Number(seconds) > 86400)) return;
  if (until != null && (typeof until !== 'string' || until.length > 64 || !Number.isFinite(Date.parse(until)))) return;
  if (['rate_limited','cooldown'].includes(String(row.code)) && (seconds == null || until == null)) return;
  if (row.http_status != null && (!Number.isInteger(row.http_status) || Number(row.http_status) < 100 || Number(row.http_status) > 599)) return;
  return {code:String(row.code),phase:String(row.phase),attempts_started:Number(row.attempts_started),
    http_status:row.http_status as number | null | undefined,retry_after_seconds:seconds as number | null | undefined,
    cooldown_until:until as string | null | undefined};
}
export function arxivGateMessage(status: ArxivGateStatus): string {
  if (status.code === 'rate_limited' || status.code === 'cooldown') {
    const seconds = status.retry_after_seconds ?? 300;
    return 'arXiv 暂时限制了请求，约 ' + Math.floor(seconds / 60) + ' 分 ' + seconds % 60 + ' 秒后可重试；到期不保证网站已恢复。';
  }
  const messages: Record<string,string> = {queue_timeout:'arXiv 排队超时，本次未获得发送机会。',queue_full:'arXiv 等待请求过多，本次未入队。',
    request_timeout:'arXiv 单次请求超时，允许的一次重试已结束。',total_timeout:'arXiv 检索总时间已用完。',
    cancelled:'arXiv 请求已取消。',state_storage_error:'arXiv 冷却状态无法读取或保存，本次检索已停止。'};
  return messages[status.code] ?? 'arXiv 请求未完成，请根据已有结果说明未完成部分。';
}
export function safeArxivGateMessage(error: unknown): string | undefined {
  const parsed = arxivGateStatus(error); if (parsed) return arxivGateMessage(parsed);
  const text = typeof error === 'string' ? error : error instanceof Error ? error.message : '';
  if (/^arXiv 暂时限制了请求，约 \d{1,4} 分 [0-5]?\d 秒后可重试；到期不保证网站已恢复。$/.test(text)) return text;
  return ['queue_timeout','queue_full','request_timeout','total_timeout','cancelled','state_storage_error']
    .map(code => arxivGateMessage({code,phase:'request',attempts_started:0})).find(message => message === text);
}
