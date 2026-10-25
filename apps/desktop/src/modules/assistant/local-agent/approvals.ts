import type { RunAssistantHarnessOptions } from '../harness/engine';
import { protocolObject } from './protocol';
import { userInputAnswerError } from '../runtime/userInput';
import { localAgentName, type LocalAgentProvider } from '@/shared/lib/localAgentSettings';

/** Host grants are checked after native guards; CLI permissions remain single-call decisions. */
export async function approveClaudeTool(input: unknown, id: string, options: RunAssistantHarnessOptions, provider:LocalAgentProvider = 'claude') {
  const displayName = localAgentName(provider);
  const request = protocolObject(input);
  const name = typeof request.tool_name === 'string' ? request.tool_name : '';
  const args = protocolObject(request.input);
  if (!name) return { behavior: 'deny', message: '工具请求无效。' };
  if (name === 'AskUserQuestion') {
    const questions = Array.isArray(args.questions) ? args.questions.map(protocolObject) : [];
    if (!options.requestUserInput || !questions.length || questions.length > 4) return { behavior: 'deny', message: '当前问题无法显示，请在对话中询问。' };
    const form = questions.map((question, index) => ({ id: String(index), title: String(question.question ?? '').slice(0, 2000),
      multiple: question.multiSelect === true,
      options: (Array.isArray(question.options) ? question.options.map(protocolObject) : []).slice(0, 4).map((item, n) => ({ id: String(n), label: String(item.label ?? '').slice(0,200), description: String(item.description ?? '').slice(0,1000) })) }));
    if (form.some(q => !q.title || q.options.some(option => !option.label))) return { behavior:'deny', message:'问题格式无效。' };
    const answers = await options.requestUserInput({ title: `${displayName} 需要你的选择`, questions: form, toolCallId: id, sources: [] }, options.abortSignal);
    options.abortSignal?.throwIfAborted();
    if (userInputAnswerError({title:'Claude',questions:form}, answers)) return {behavior:'deny',message:'回答格式无效，请重新提问。'};
    return { behavior: 'allow', updatedInput: { ...args, answers: Object.fromEntries(form.map((q, i) => [String(questions[i].question),
      [...answers[q.id].selected.map(value => q.options.find(option => option.id === value)?.label ?? ''), answers[q.id].text].filter(Boolean).join(', ')])) } };
  }
  // NeuInk persistence must always go through its own immutable proposals.
  if (/^(Edit|Write|Permissions|apply_patch|patch)$/i.test(name)) {
    const root = options.root.replace(/\\/g,'/').replace(/\/$/,'').toLowerCase();
    const paths = nativePaths(args);
    if (paths.some(value => {
      const path=value.replace(/\\/g,'/').toLowerCase();
      return path === root || path.startsWith(`${root}/`) || path.split('/').includes('..');
    })) return { behavior:'deny', message:'NeuInk 资料库请使用 MCP 提案工具修改。' };
  }
  const approved = await options.requestToolApproval?.({ toolCallId:id, toolName:`${provider}.${name}`, input:args }, options.abortSignal);
  options.abortSignal?.throwIfAborted();
  return approved ? { behavior:'allow', updatedInput:args } : { behavior:'deny', message:'用户拒绝了本次操作，不得重试。' };
}

function nativePaths(value:unknown):string[] {
  if (Array.isArray(value)) return value.flatMap(nativePaths);
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key,item])=>
    /^(path|file_path|filePath|filepath|movePath|grantRoot)$/i.test(key) && typeof item === 'string' ? [item] : nativePaths(item));
}
