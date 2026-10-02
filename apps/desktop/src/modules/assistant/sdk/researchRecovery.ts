import { RESEARCH_READ_TOOLS } from '@/shared/ipc/researchApi';
import type { AssistantToolTraceEvent } from '@/shared/ipc/assistantApi';
import { toolFingerprint } from '../agent-core/cycleGuard';

const READ_TOOLS = new Set<string>([...RESEARCH_READ_TOOLS, 'search_sciverse_evidence', 'read_sciverse_content',
  'search_sciverse_metadata', 'get_sciverse_metadata_catalog', 'search_sciverse_paper_schema', 'get_sciverse_paper_schema']);
const NO_RETRY_STATUS = /\bHTTP\s+(?:401|403|404|410|429)\b/i;
const NEXT_STEP = '这是只读检索失败，不是修改结果不明。请改用本轮已启用的其他检索工具或其他公开来源；论文可从已返回的 DOI、标题、公开版本继续查找。不要自行开启工具、绕过登录或访问限制、编造网址或结果。若无替代来源，请汇总已有证据并说明未读取到的内容，不要把摘要当作全文。';

/** Keep failure semantics (error-text) while giving the model an actionable next step. */
export function researchFailureMessage(name: string, message: string) {
  if (!READ_TOOLS.has(name)) return message;
  return `${message}\n${NO_RETRY_STATUS.test(message) ? '不要再次请求同一目标；' : '不要反复提交相同请求；'}${NEXT_STEP}`;
}

function requestKey(name: string, input: unknown) {
  const { root: _root, ...args } = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  if (name === 'read_webpage' && typeof args.url === 'string') {
    try {
      const url = new URL(args.url);
      url.hash = ''; // Fragments do not change an HTTP request.
      args.url = url.href;
    } catch { /* Native validation reports invalid URLs. */ }
  }
  return toolFingerprint(name, args);
}

/** Existing durable events own this state, including within a tool batch and after restore. */
export function assertResearchRetry(name: string, input: unknown, events: readonly AssistantToolTraceEvent[]) {
  if (!READ_TOOLS.has(name)) return;
  const key = requestKey(name, input);
  const failures = events.filter(event => event.toolName === name && event.status === 'error'
    && requestKey(name, event.input) === key);
  if (failures.some(event => NO_RETRY_STATUS.test(event.error ?? '')) || failures.length >= 2) {
    throw new Error('已跳过重复失败的检索请求（READ_RETRY_SKIPPED）。请更换来源或整理已有结果。');
  }
}
