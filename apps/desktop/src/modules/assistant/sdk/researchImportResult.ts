import { assistantErrorDiagnostic } from '@/shared/lib/assistantDebug';
import { createAgentToolFailure } from '../agent-core/toolFailure';

const notice = 'PDF 入库不代表已解析或已读全文。请核对已有条目；失败项需要重新确认，不要自动重试整个批次。';
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const id = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 300;

/** A write result must account for every requested identity exactly once. */
export function researchImportResult(output: unknown, requestedIds: unknown) {
  const expected = Array.isArray(requestedIds) ? requestedIds.filter(id) : [];
  const raw = object(output).results;
  const rows = Array.isArray(raw) ? raw.map(object) : [];
  const complete = Array.isArray(requestedIds) && expected.length === requestedIds.length
    && expected.length > 0 && expected.length <= 10 && new Set(expected).size === expected.length
    && rows.length === expected.length && new Set(rows.map(row => row.id)).size === rows.length
    && rows.every(row => id(row.id) && expected.includes(row.id) && (row.status === 'failed'
      || ((row.status === 'imported' || row.status === 'already_in_library') && id(row.entry_id))));
  const results = rows.slice(0, 10).filter(row => id(row.id) && expected.includes(row.id)).map(row => ({
    id: row.id as string,
    ...(id(row.entry_id) ? { entry_id: row.entry_id } : {}),
    status: row.status === 'failed' ? 'failed' : id(row.entry_id) && (row.status === 'imported' || row.status === 'already_in_library') ? row.status : 'unknown',
    ...(typeof row.parsed === 'boolean' ? { parsed: row.parsed } : {}),
    ...(row.status === 'failed' ? { error: assistantErrorDiagnostic(row.error) } : {})
  }));
  if (!complete) return {
    modelOutput: { ...createAgentToolFailure('TOOL_OUTCOME_UNKNOWN'), results, notice },
    sources: [], summary: '下载回执不完整，无法确认全部结果；请核对文库，勿重复下载。'
  };
  if (results.some(row => row.status === 'failed')) return {
    modelOutput: { ...createAgentToolFailure('TOOL_PARTIAL_FAILURE'), results, notice },
    sources: [], summary: '论文下载入库未全部完成，请核对逐项结果。'
  };
  const imported = results.filter(row => row.status === 'imported').length;
  const existing = results.filter(row => row.status === 'already_in_library').length;
  return { modelOutput: { results, notice }, sources: [], summary: [
    imported ? `PDF 已下载入库 ${imported} 篇，尚未解析。` : '',
    existing ? `${existing} 篇已在文库，无需重复下载。` : ''
  ].filter(Boolean).join(' ') };
}
