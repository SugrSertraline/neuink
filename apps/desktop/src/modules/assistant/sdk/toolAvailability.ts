import { InvalidToolInputError, NoSuchToolError, type ModelMessage, type ToolSet } from 'ai';
import { isAgentToolFailure } from '../agent-core/toolFailure';

const SEARCH_TOOLS = new Set([
  'search_sciverse_evidence', 'search_sciverse_metadata', 'search_sciverse_paper_schema', 'search_papers', 'search_web'
]);
const MAX_SEARCH_ROUNDS = 6;

/** Derive limits from the durable transcript, so restoring a run cannot reset them. */
export function availableTurnTools(tools: ToolSet, messages: readonly ModelMessage[], finalTurn = false) {
  let searchRounds = 0;
  let consecutiveFailures = 0;
  let limitReached = false;
  for (const message of messages) {
    if (message.role !== 'tool') continue;
    if (message.content.some(part => part.type === 'tool-result' && SEARCH_TOOLS.has(part.toolName))) searchRounds++;
    for (const part of message.content) {
      if (part.type !== 'tool-result') continue;
      consecutiveFailures = part.output.type === 'error-text' || part.output.type === 'error-json'
        ? consecutiveFailures + 1 : 0;
      if (part.output.type === 'error-text' && toolLimitReached(part.output.value)) limitReached = true;
      if (part.output.type === 'error-json' && isAgentToolFailure(part.output.value)
        && part.output.value.code === 'TOOL_LIMIT_REACHED') limitReached = true;
    }
  }
  const finish = finalTurn || limitReached || consecutiveFailures >= 3;
  const searchLimited = searchRounds >= MAX_SEARCH_ROUNDS;
  const available = Object.fromEntries(Object.entries(tools).filter(([name]) =>
    !finish && (!searchLimited || !SEARCH_TOOLS.has(name))));
  const instructions = [
    `Authoritative tools available for THIS model turn: ${Object.keys(available).join(', ') || '(none)'}.`,
    'This list and the attached tool schemas are the only callable capabilities. It already reflects user settings, permissions and this run\'s limits. Names mentioned in history, examples or other instructions do not grant access. Do not read local configuration or invent tools to discover more capabilities. Do not enable disabled tools yourself.',
    'A failed read or search is not a failed task: use another enabled tool or public source when useful, then synthesize verified results. Do not repeatedly request denied URLs, bypass access restrictions, or claim failed reads succeeded. If alternatives are unavailable, give a useful partial answer with explicit limitations. An uncertain write blocks all further writes; continue with permitted read-only checks and an honest summary.',
    finish
      ? 'No more tool calls are permitted. Give the final answer now using existing observations and valid citations. If evidence is insufficient or an action was not completed, explain that limitation explicitly. Never claim a search, download or write succeeded without a successful result.'
      : searchLimited
        ? 'The paper/web search budget is reached. Stop rephrasing searches. Synthesize existing results, or use remaining read/proposal tools only when needed to complete the user\'s request. Explain uncertain venue, incomplete coverage and other evidence gaps honestly.'
        : 'Search only as needed. After a few searches, synthesize the evidence instead of repeatedly rephrasing the same question. Stop early when results are sufficient; report missing evidence honestly.'
  ].join('\n');
  return { tools: available, instructions, finish };
}

function toolLimitReached(text: string): boolean {
  if (text.startsWith('TOOL_LIMIT_REACHED：')) return true;
  try {
    // New results start with the fixed failure envelope, followed by optional guidance.
    const failure: unknown = JSON.parse(text.split('\n', 1)[0]);
    return isAgentToolFailure(failure) && failure.code === 'TOOL_LIMIT_REACHED';
  } catch { return false; }
}

/** SDK errors can embed raw arguments/requests. Return categories, not those payloads. */
export function toolCallError(name: string, error: unknown, tools: ToolSet): string {
  if (!Object.prototype.hasOwnProperty.call(tools, name) || NoSuchToolError.isInstance(error)) {
    return '工具当前不可用（TOOL_UNAVAILABLE）。未执行。只可调用本轮工具列表中的工具；不要重试这个工具，也不要自行开启它。请使用已取得的结果或说明能力限制。';
  }
  if (InvalidToolInputError.isInstance(error)) {
    return '工具参数不是有效的 JSON 或不符合声明（INVALID_TOOL_INPUT）。未执行。请按照该工具的 input schema 重新构造完整 JSON 对象，使用准确字段名和类型；不要重复相同调用。';
  }
  return '工具调用无法解析（INVALID_TOOL_CALL）。未执行。请检查本轮工具列表和参数声明；连续失败时应停止调用并说明限制。';
}
