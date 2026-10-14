import type { AssistantToolTraceEvent } from '@/shared/ipc/assistantApi';
import { PdfReadingAudit } from './pdfReading';
import { ASSISTANT_READ_FAILURES } from '@/shared/lib/assistantReadFailure';
import { CLAUDE_CODE_DISPLAY_NAME } from '@/shared/lib/localAgentSettings';
import { ReasoningBlocks } from './reasoningBlocks';

const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
/** Partial messages and complete blocks overlap: consume each text block exactly once. */
export class ClaudeStream {
  private current = '';
  private blocks = new Map<number, string>();
  private tools = new Map<string, string>();
  private seen = new Set<string>();
  private streamed = false;
  private messageId = '';
  private inputs = new Map<string, unknown>();
  private thinkingIndex: number | null = null;
  private thinkingStep = 0;
  private reasoning = new ReasoningBlocks(text => this.callbacks.reasoning(text));
  readonly pdfReading = new PdfReadingAudit(id => this.callbacks.tool({id, toolName:'claude.mcp__neuink__read_pdf_pages',
    status:'error', recovered:true, summary:'读取请求已调整，后续调用已覆盖原请求页码。'}));
  constructor(private callbacks: { text: (delta: string) => void; reset: () => void;
    reasoning: (delta: string) => void; tool: (event: AssistantToolTraceEvent) => void; initialized: () => void }) {}
  consume(value: Record<string, unknown>) {
    // Subagent text is not a second main answer.
    if (value.parent_tool_use_id) return;
    if (value.type === 'system' && value.subtype === 'init') {
      const servers = Array.isArray(value.mcp_servers) ? value.mcp_servers.map(object) : [];
      if (!servers.some(server => server.name === 'neuink' && server.status === 'connected')) throw new Error('NeuInk 工具连接失败，请重试。');
      this.callbacks.initialized(); return;
    }
    if (value.type === 'stream_event') {
      const event = object(value.event), delta = object(event.delta);
      const index = typeof event.index === 'number' ? event.index : 0;
      if (event.type === 'message_start') {
        this.blocks.clear(); this.current = ''; this.streamed = true;
        this.thinkingIndex = null; this.thinkingStep += 1;
        this.messageId = String(object(event.message).id ?? ''); this.callbacks.reset();
      }
      const block = object(event.content_block);
      if (event.type === 'content_block_start' && block.type === 'text' && typeof block.text === 'string' && block.text) {
        this.blocks.set(index, block.text); this.current += block.text; this.callbacks.text(block.text);
      }
      if (event.type === 'content_block_delta' && delta.type === 'text_delta' && typeof delta.text === 'string') {
        this.blocks.set(index, (this.blocks.get(index) ?? '') + delta.text);
        this.current += delta.text; this.callbacks.text(delta.text);
      }
      if (event.type === 'content_block_start' && block.type === 'thinking') {
        this.thinkingIndex = index;
        if (typeof block.thinking === 'string') this.reasoning.append(this.thinkingKey(index), block.thinking);
      }
      if (event.type === 'content_block_delta' && delta.type === 'thinking_delta' && typeof delta.thinking === 'string') {
        this.thinkingIndex = index;
        this.reasoning.append(this.thinkingKey(index), delta.thinking);
      }
      return;
    }
    if (value.type === 'assistant') {
      const uuid = typeof value.uuid === 'string' ? value.uuid : '';
      if (uuid && this.seen.has(uuid)) return;
      if (uuid) this.seen.add(uuid);
      const message = object(value.message), content = message.content;
      if (!Array.isArray(content)) return;
      let text = '';
      for (const [index, item] of content.map(object).entries()) {
        if (item.type === 'text' && typeof item.text === 'string') text += item.text;
        if (item.type === 'thinking' && typeof item.thinking === 'string') {
          const streamedMessage = this.streamed && String(message.id ?? '') === this.messageId;
          // Claude Code completes one block per assistant event, before block_stop.
          const blockIndex = content.length === 1 ? this.thinkingIndex ?? index : index;
          const key = streamedMessage ? this.thinkingKey(blockIndex) : `complete:${uuid || String(message.id ?? '')}:${index}`;
          this.reasoning.complete(key, item.thinking);
        }
        if (item.type === 'tool_use' && typeof item.id === 'string' && typeof item.name === 'string') {
          this.tools.set(item.id, item.name);
          this.inputs.set(item.id, item.input);
          this.callbacks.tool({ id: item.id, toolName: `claude.${item.name}`, status: 'running', summary: `${CLAUDE_CODE_DISPLAY_NAME} 正在调用 ${item.name}` });
        }
      }
      // CLI emits complete blocks as well as deltas. Streamed text is authoritative;
      // a complete block may contain only part of an already displayed message.
      if (text && (!this.streamed || !this.current)) {
        const id = String(message.id ?? uuid);
        if (id !== this.messageId) { this.current = ''; this.callbacks.reset(); }
        this.messageId = id; this.current += text; this.callbacks.text(text);
      }
      return;
    }
    if (value.type === 'user') {
      const content = object(value.message).content;
      if (Array.isArray(content)) for (const item of content.map(object)) {
        const name = this.tools.get(String(item.tool_use_id));
        if (item.type === 'tool_result' && name) {
          const id = String(item.tool_use_id);
          const text = typeof item.content === 'string' ? item.content : Array.isArray(item.content)
            ? item.content.map(object).map(block => typeof block.text === 'string' ? block.text : '').join('\n') : '';
          const rejectedBatch = item.is_error && name === 'mcp__neuink__read_pdf_pages' && text.includes('INVALID_TOOL_INPUT')
            && /data\/page_count must be <= 5/.test(text);
          const readTooLarge = item.is_error && name === 'Read'
            && /File content \([\d,]+ tokens\) exceeds maximum allowed tokens \([\d,]+\)/.test(text);
          this.callbacks.tool({ id, toolName: `claude.${name}`,
            status: item.is_error ? 'error' : 'done', ...(rejectedBatch ? {error:ASSISTANT_READ_FAILURES.pageBatch} : {}),
            ...(readTooLarge ? {error:ASSISTANT_READ_FAILURES.localReadLimit} : {}),
            summary: item.is_error ? `${CLAUDE_CODE_DISPLAY_NAME} 工具调用失败。` : `${CLAUDE_CODE_DISPLAY_NAME} 工具调用完成。` });
          if (rejectedBatch) this.pdfReading.rejectPageCount(id,this.inputs.get(id));
        }
      }
    }
  }
  private thinkingKey(index: number) { return `stream:${this.thinkingStep}:${index}`; }
}

export { object as protocolObject };
