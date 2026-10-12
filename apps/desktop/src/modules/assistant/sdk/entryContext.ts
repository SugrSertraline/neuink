import type { ConversationSourceLink, ReadEntryAssistantContextResponse } from '@/shared/ipc/assistantApi';
import { AgentToolNotExecutedError } from '../agent-core/agent';
import { stableHash } from '../runtime/evidenceLedger';

export const ENTRY_CONTEXT_PAGE_CHARS = 8_000;
export const ENTRY_CONTEXT_MAX_CHARS = 12_000;
type ReadWindow = { offset?: unknown; limit?: unknown; revision?: unknown };

export function entryContextWindow(input: ReadWindow) {
  const offset = input.offset ?? 0, limit = input.limit ?? ENTRY_CONTEXT_PAGE_CHARS;
  if (!Number.isSafeInteger(offset) || Number(offset) < 0 || !Number.isInteger(limit)
    || Number(limit) < 100 || Number(limit) > ENTRY_CONTEXT_MAX_CHARS
    || (input.revision !== undefined && (typeof input.revision !== 'string' || !/^[a-f0-9]{8}$/.test(input.revision)))) {
    throw new AgentToolNotExecutedError('解析正文读取参数无效，请使用返回的 next_read 继续读取。', 'TOOL_INVALID_ARGUMENTS');
  }
  return { offset: Number(offset), limit: Number(limit), revision: input.revision as string | undefined };
}

/** Bound model-visible reads independently of the model's total context window. */
export function formatReadEntryOutput(result: ReadEntryAssistantContextResponse,
  addSource: (source: ConversationSourceLink) => number, contextBudget: number, input: ReadWindow = {}) {
  const { offset, limit, revision: expectedRevision } = entryContextWindow(input);
  const text = result.markdown;
  const revision = stableHash(JSON.stringify([result.entry_id, text, result.sources]));
  if (offset > text.length || (offset > 0 && expectedRevision !== revision)) {
    throw new AgentToolNotExecutedError('解析正文已变化或续读位置无效，请从 offset=0 重新读取。', 'TOOL_PREFLIGHT_FAILED');
  }
  const budget = Math.max(100, Math.min(limit, contextBudget));
  let end = Math.min(text.length, offset + budget);
  // Prefer complete segments. A single long segment still advances without splitting a citation or surrogate pair.
  const boundary = text.lastIndexOf('\n[S', end);
  if (end < text.length && boundary > offset + budget / 2) end = boundary;
  if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1] ?? '')) end--;
  const markerStart = text.lastIndexOf('[S', end - 1);
  if (markerStart > offset && /^\[S\d*$/.test(text.slice(markerStart, end))) end = markerStart;

  const markers = new Map<number, number>();
  const sources: ConversationSourceLink[] = [];
  const register = (original: number) => {
    const source = result.sources[original - 1];
    if (!source) return null;
    if (!markers.has(original)) { markers.set(original, addSource(source)); sources.push(source); }
    return markers.get(original)!;
  };
  let continuation = '';
  if (offset > 0 && !/^\s*(?:\[S\d+] segment_uid:|## )/.test(text.slice(offset, end))) {
    const headers = [...text.slice(0, offset).matchAll(/^\[S(\d+)] segment_uid: [^\n]*\n/gm)];
    const previous = headers[headers.length - 1];
    if (previous && !text.slice(previous.index, offset).includes('\n## Annotations')) {
      const marker = register(Number(previous[1]));
      if (marker !== null) continuation = `[S${marker}] (continued segment)\n`;
    }
  }
  const markdown = continuation + text.slice(offset, end).replace(/\[S(\d+)]/g, (full, markerText: string) => {
    const marker = register(Number(markerText));
    return marker === null ? full : `[S${marker}]`;
  });
  const more = end < text.length;
  return {
    modelOutput: {
      kind: 'read_entry_assistant_context', reading_mode: 'parsed_markdown',
      entry_id: result.entry_id, entry_title: result.entry_title, markdown,
      source_markers: [...markers.values()].map(marker => `[S${marker}]`),
      offset, chars_returned: end - offset, total_chars: text.length, revision,
      more, next_offset: more ? end : null,
      next_read: more ? { entry_id: result.entry_id, offset: end, limit, revision } : null,
      truncated_for_context: offset > 0 || more,
      note: more ? '仅返回部分解析正文。继续调用 read_entry_assistant_context 并传入 next_read；不要使用原生 Read 或 shell 读取工具临时文件。'
        : offset > 0 ? '已到达解析正文末尾；只有之前各段均已读取时，才能称为全文读取。' : '已返回全部解析正文；图片与未解析内容不包含在内。',
    },
    sources,
    summary: text.trim() ? `已读取 ${result.entry_title} 的解析正文 ${offset + 1}–${end}/${text.length} 字符${more ? '，可继续读取。' : '。'}`
      : `${result.entry_title} 暂无解析正文${result.has_pdf ? '，可用 PDF 基础读取工具读取文字层。' : '或可读 PDF，请附加文件或选择其他资料。'}`,
  };
}

/** A final chunk alone never establishes whole-document coverage. */
export function parsedEntryReadingNotice(observations: readonly { output: unknown }[]) {
  const entries = new Map<string, { revision: string; total: number; ranges: Array<[number, number]> }>();
  for (const { output } of observations) {
    if (!output || typeof output !== 'object') continue;
    const value = output as Record<string, unknown>;
    if (value.kind !== 'read_entry_assistant_context' || value.reading_mode !== 'parsed_markdown'
      || typeof value.entry_id !== 'string' || typeof value.revision !== 'string'
      || !Number.isSafeInteger(value.offset) || !Number.isSafeInteger(value.chars_returned) || !Number.isSafeInteger(value.total_chars)) continue;
    const start = Number(value.offset), end = start + Number(value.chars_returned), total = Number(value.total_chars);
    if (start < 0 || end <= start || end > total) continue;
    const previous = entries.get(value.entry_id);
    // A changed document must be read afresh; discarded revisions cannot fill its gaps.
    const entry = previous?.revision === value.revision && previous.total === total
      ? previous : { revision: value.revision, total, ranges: [] };
    entry.ranges.push([start, end]); entries.set(value.entry_id, entry);
  }
  const partial = [...entries.values()].some(entry => {
    let end = 0;
    for (const [start, next] of entry.ranges.sort((a, b) => a[0] - b[0])) {
      if (start > end) return true;
      end = Math.max(end, next);
    }
    return end < entry.total;
  });
  return partial ? '读取说明：本轮尚未覆盖全部解析正文，回答基于已取得的部分内容。' : '';
}
