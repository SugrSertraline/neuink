import type { AssistantToolTraceEvent } from '@/shared/ipc/assistantApi';
import { localAgentName, type LocalAgentProvider } from '@/shared/lib/localAgentSettings';
import { PdfReadingAudit } from './pdfReading';
import { protocolObject as object } from './protocol';
import { ASSISTANT_READ_FAILURES } from '@/shared/lib/assistantReadFailure';

export type AgentStreamCallbacks = {text:(delta:string)=>void; reset:()=>void; reasoning:(delta:string)=>void;
  tool:(event:AssistantToolTraceEvent)=>void; initialized:(sessionId?:string)=>void};

/** App Server and ACP notifications are scoped by the backend to this turn, excluding replay. */
export class RpcAgentStream {
  private messageId = '';
  private messageText = '';
  private tools = new Map<string, {name:string;input:unknown}>();
  readonly pdfReading = new PdfReadingAudit(id => this.callbacks.tool({id,toolName:`${this.provider}.mcp__neuink__read_pdf_pages`,
    status:'error',recovered:true,summary:'读取请求已调整，后续调用已覆盖原请求页码。'}));
  constructor(private provider: Exclude<LocalAgentProvider,'claude'>, private callbacks:AgentStreamCallbacks) {}
  consume(value:Record<string,unknown>) {
    if (value.type === 'local_agent_init' && typeof value.session_id === 'string') {
      this.callbacks.initialized(value.session_id); return;
    }
    const params=object(value.params);
    if (this.provider === 'codex') {
      if (value.method === 'item/agentMessage/delta' && typeof params.delta === 'string') {
        this.startMessage(String(params.itemId)); this.messageText+=params.delta; this.callbacks.text(params.delta);
      }
      if ((value.method === 'item/reasoning/summaryTextDelta' || value.method === 'item/reasoning/textDelta') && typeof params.delta === 'string') this.callbacks.reasoning(params.delta);
      if (value.method === 'item/started' || value.method === 'item/completed') {
        const item=object(params.item), id=String(item.id ?? '');
        if (item.type === 'agentMessage' && value.method === 'item/completed' && typeof item.text === 'string') {
          this.startMessage(id);
          if (item.text !== this.messageText) { this.messageText=item.text; this.callbacks.reset(); this.callbacks.text(item.text); }
        } else if (['mcpToolCall','commandExecution','fileChange','dynamicToolCall','webSearch'].includes(String(item.type))) {
          const name=item.type === 'mcpToolCall' ? `mcp__${String(item.server)}__${String(item.tool)}` : String(item.type);
          this.tool(id,name,item.arguments ?? item.command ?? item.changes,value.method === 'item/started' ? 'running'
            : item.status === 'failed' || item.status === 'declined' || item.error || object(item.result).isError === true ? 'error' : 'done',item.error ?? item.result);
        }
      }
    } else if (value.method === 'session/update') {
      const update=object(params.update), content=object(update.content);
      if (update.sessionUpdate === 'agent_message_chunk' && content.type === 'text' && typeof content.text === 'string') {
        if (typeof update.messageId === 'string') this.startMessage(update.messageId);
        this.messageText+=content.text; this.callbacks.text(content.text);
      }
      if (update.sessionUpdate === 'agent_thought_chunk' && typeof content.text === 'string') this.callbacks.reasoning(content.text);
      if (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') {
        const id=String(update.toolCallId ?? ''), previous=this.tools.get(id);
        const name=(typeof update.name === 'string' ? update.name : previous?.name ?? String(update.title ?? update.kind ?? 'tool')).replace(/^neuink_/, 'mcp__neuink__');
        this.tool(id,name,update.rawInput ?? previous?.input,update.status === 'completed' ? 'done' : update.status === 'failed' ? 'error' : 'running',update.rawOutput ?? update.content);
      }
    }
  }
  private startMessage(id:string) {
    if (this.messageId !== id) {this.messageId=id;this.messageText='';this.callbacks.reset();}
  }
  private tool(id:string,name:string,input:unknown,status:AssistantToolTraceEvent['status'],diagnostic?:unknown) {
    if (!id) return;
    input ??= this.tools.get(id)?.input;
    if (typeof input === 'string') { try {input=JSON.parse(input);} catch { /* Native command text is not JSON. */ } }
    this.tools.set(id,{name,input});
    const detail=typeof diagnostic === 'string' ? diagnostic : JSON.stringify(diagnostic) ?? '';
    const rejectedBatch=status === 'error' && name === 'mcp__neuink__read_pdf_pages'
      && detail.includes('INVALID_TOOL_INPUT') && /data\/page_count must be <= 5/.test(detail);
    this.callbacks.tool({id,toolName:`${this.provider}.${name}`,input,status,
      ...(rejectedBatch ? {error:ASSISTANT_READ_FAILURES.pageBatch} : {}),
      summary:`${localAgentName(this.provider)} ${status === 'running' ? '正在调用' : status === 'error' ? '工具调用失败' : '工具调用完成'} ${name}`});
    if (rejectedBatch) this.pdfReading.rejectPageCount(id,input);
  }
}
