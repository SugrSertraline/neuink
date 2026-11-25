import { jsonSchema, tool } from 'ai';
import type { AssistantToolTraceEvent } from '@/shared/ipc/assistantApi';
import { readBrowserTab, type BrowserTabTarget } from '@/shared/ipc/browserApi';
import type { AgentLoopGuard } from '../agent-core';
import { toolPreflight } from './toolFailurePolicy';
import { resolveBrowserContent } from './browserTabContent';

type BrowserReadInput = { mode?: 'text' | 'selection'; start_page?: number; page_count?: number };

export function createBrowserTabTool(options: {
  target: BrowserTabTarget | null;
  contextBudget: number;
  abortSignal?: AbortSignal;
  loopGuard?: AgentLoopGuard;
  emit: (event: AssistantToolTraceEvent) => void;
  observe: (output: unknown) => void;
}) {
  // Submitted UI context owns this capability, even if the live tab selection changes.
  const target = options.target ? Object.freeze({ ...options.target }) : null;
  const charBudget = Math.max(0, Math.min(40_000, Math.floor(options.contextBudget / 4)));
  return tool({
    description: 'Read the frozen browser tab: loaded article text, public PDF text pages (PDF.js), or YouTube/Bilibili subtitles (yt-dlp). Requires a captured browser target in workspace_context; never infer it from history. Selection reads DOM only. No cookies, video download, navigation, other-tab access, local Segment markers or writes. Check contentType, extractor, pagesRead, limitations and truncated; subtitles/metadata are not video understanding. Do not bypass a failed tab read by fetching its URL elsewhere. Only when requested by the user.',
    inputSchema: jsonSchema<BrowserReadInput>({
      type: 'object', additionalProperties: false,
      properties: { mode: { type: 'string', enum: ['text', 'selection'], description: 'Read content (default), or only the current DOM selection without network media extraction.' },
        start_page: { type: 'integer', minimum: 1, maximum: 2000, description: 'PDF only: first page, default 1.' },
        page_count: { type: 'integer', minimum: 1, maximum: 20, description: 'PDF only: up to 20 pages, default 8; returned text may be truncated.' } }
    }),
    execute: async (input, call) => {
      const signal = call.abortSignal ?? options.abortSignal;
      signal?.throwIfAborted();
      const frozenTarget = toolPreflight(() => {
        if (!target) throw new Error('No browser target was captured. Ask the user to associate a tab or supply a public URL for read_webpage. No page was read.');
        return target;
      }, 'TOOL_PREFLIGHT_FAILED');
      const mode = toolPreflight(() => {
        if (!input || typeof input !== 'object' || Array.isArray(input) ||
            Object.keys(input).some(key => !['mode', 'start_page', 'page_count'].includes(key)) ||
            (input.mode !== undefined && input.mode !== 'text' && input.mode !== 'selection')) {
          throw new Error('Only mode=text or mode=selection is accepted.');
        }
        for (const [value, max] of [[input.start_page, 2000], [input.page_count, 20]]) {
          if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > max!)) throw new Error('Invalid PDF page range.');
        }
        return input.mode ?? 'text';
      });
      const args = { mode, ...(input.start_page !== undefined ? { start_page: input.start_page } : {}),
        ...(input.page_count !== undefined ? { page_count: input.page_count } : {}) };
      const fingerprint = options.loopGuard?.beforeToolCall('read_browser_tab', args);
      options.emit({ id: call.toolCallId, toolName: 'read_browser_tab', input: args,
        status: 'running', summary: mode === 'selection' ? '正在读取网页选区。' : '正在读取当前网页。' });
      try {
        const raw = await readBrowserTab(frozenTarget, signal, mode);
        const snapshot = await resolveBrowserContent(raw, frozenTarget, signal, input.start_page, input.page_count);
        signal?.throwIfAborted();
        // The backend validates the frozen URL/navigation before and after evaluation.
        // Its returned citation URL intentionally omits private query and fragment values.
        const content = mode === 'selection' ? snapshot.selection : snapshot.text;
        const text = content.slice(0, charBudget);
        const output = {
          kind: 'browser_tab_snapshot', mode,
          title: (snapshot.title || frozenTarget.title).slice(0, 1_000), url: snapshot.url,
          capturedAt: snapshot.capturedAt, text,
          contentType: snapshot.contentType ?? 'webpage', extractor: snapshot.extractor ?? 'visible-text',
          ...(snapshot.pageCount ? { pageCount: snapshot.pageCount, pagesRead: snapshot.pagesRead } : {}),
          limitations: snapshot.limitations,
          truncated: snapshot.truncated || content.length > text.length,
          status: text.trim() ? 'read' : 'empty',
          limitation: text.trim() ? 'Only the text coverage declared by contentType, pagesRead and limitations was read. Do not infer missing pages, subtitles, images, audio or video.'
            : mode === 'selection' ? 'There is no readable text selection in this tab.' : 'This tab returned no readable rendered text.'
        };
        options.observe(output);
        options.loopGuard?.recordSuccess(output);
        const label = snapshot.contentType === 'pdf' ? 'PDF 文字' : snapshot.contentType === 'video_subtitles' ? '视频字幕'
          : snapshot.contentType === 'video_metadata' ? '视频简介（非视频内容）' : '网页正文';
        options.emit({ id: call.toolCallId, toolName: 'read_browser_tab', input: args, status: 'done',
          summary: text.trim() ? `已读取${mode === 'selection' ? '网页选区' : label}${output.truncated ? '（内容有截断）' : ''}。`
            : mode === 'selection' ? '网页当前没有可读选区。' : '网页未返回可读正文。' });
        return output;
      } catch (error) {
        if (fingerprint) options.loopGuard?.recordFailure(fingerprint);
        throw error;
      }
    }
  });
}
