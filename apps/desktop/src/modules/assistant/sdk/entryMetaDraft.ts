import { generateText } from 'ai';

import type { ConversationSourceLink, LlmProfile } from '@/shared/ipc/assistantApi';
import { readEntryAssistantContext } from '@/shared/ipc/assistantApi';
import type {
  AssistantEntryMetaTarget,
  AssistantTaskPlan
} from '@/shared/types/assistant';

import { assistantContextCharBudget } from './contextBudget';
import { buildEntryMetaProposal } from './entryMetaProposal';
import { createNeuinkModel, generationSettings } from './provider';
import { requestAssistantClarification } from '../runtime/clarification';

type GenerateEntryMetaDraftOptions = {
  abortSignal?: AbortSignal;
  availableEntries: AssistantEntryMetaTarget[];
  plan: AssistantTaskPlan;
  question: string;
  root: string;
  settings: LlmProfile;
};

export async function generateEntryMetaDraftProposal({
  abortSignal,
  availableEntries,
  plan,
  question,
  root,
  settings
}: GenerateEntryMetaDraftOptions) {
  const target = resolveTarget(availableEntries, plan);
  const explicitTitle = extractExplicitTitle(question);
  if (explicitTitle && onlyChangesTitle(plan)) {
    return buildEntryMetaProposal({ title: explicitTitle }, {
      entries: availableEntries,
      plan,
      sourceByMarker: new Map()
    });
  }

  const evidence = plan.needsDocumentContext
    ? await readTargetDocument(root, target.id, settings.max_context_length)
    : { sourceByMarker: new Map<number, ConversationSourceLink>(), text: '' };
  if (plan.needsDocumentContext && evidence.sourceByMarker.size === 0) {
    requestAssistantClarification(
      'document_context',
      `我还读不到“${target.title}”的解析正文。请先完成 PDF 解析，或用 @ 指定一个已经解析的 PDF，然后告诉我继续。`
    );
  }

  const result = await generateText({
    abortSignal,
    ...generationSettings(settings),
    model: createNeuinkModel(settings),
    system: [
      'You prepare a reviewable Entry metadata proposal.',
      'Return one JSON object only. Do not use Markdown fences or add commentary.',
      'Use only the requested fields. Preserve exact paper-title spelling and punctuation.',
      'When paper evidence is supplied, source_markers must cite the evidence used.'
    ].join('\n'),
    prompt: buildPrompt(question, target, plan, evidence.text)
  });
  const input = parseDraft(result.text);
  input.source_markers = normalizeSourceMarkers(input.source_markers);
  return buildEntryMetaProposal(input, {
    entries: availableEntries,
    plan,
    sourceByMarker: evidence.sourceByMarker
  });
}

function resolveTarget(entries: AssistantEntryMetaTarget[], plan: AssistantTaskPlan) {
  const entryId = plan.entryMetaChange?.entryId;
  const target = entries.find((entry) => entry.id === entryId);
  if (!target) {
    requestAssistantClarification(
      'entry_target',
      '我还不能唯一确定要修改哪个 Entry。请用 @ 指定一个 Entry 或它下面的 PDF。'
    );
  }
  return target;
}

async function readTargetDocument(root: string, entryId: string, maxContextLength: number | null) {
  const document = await readEntryAssistantContext({ root, entryId });
  const budget = assistantContextCharBudget(maxContextLength);
  const text = document.markdown.slice(0, budget);
  const sourceByMarker = new Map<number, ConversationSourceLink>();
  document.sources.forEach((source, index) => {
    const marker = index + 1;
    if (text.includes(`[S${marker}]`)) sourceByMarker.set(marker, source);
  });
  return { sourceByMarker, text };
}

function buildPrompt(
  question: string,
  target: AssistantEntryMetaTarget,
  plan: AssistantTaskPlan,
  evidence: string
) {
  const requestedFields = plan.entryMetaChange?.fields ?? [];
  return [
    `User request: ${question}`,
    `Target Entry: ${JSON.stringify({
      description: target.description,
      entry_id: target.id,
      title: target.title
    })}`,
    `Requested fields: ${requestedFields.join(', ')}`,
    'JSON schema: {"title"?: string, "description"?: string, "source_markers": string[], "rationale"?: string}',
    evidence ? `Target paper evidence:\n${evidence}` : 'No paper evidence is required.'
  ].join('\n\n');
}

function parseDraft(text: string): Record<string, unknown> {
  const match = text.trim().match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error('模型未返回有效的条目元数据草稿，请重试。');
  }
  try {
    return JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    throw new Error('模型返回的条目元数据草稿格式无效，请重试。');
  }
}

function normalizeSourceMarkers(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((marker) => typeof marker === 'number' ? `S${marker}` : marker)
    .filter((marker): marker is string => typeof marker === 'string');
}

function onlyChangesTitle(plan: AssistantTaskPlan) {
  const fields = plan.entryMetaChange?.fields ?? [];
  return fields.length === 1 && fields[0] === 'title' && plan.citationPolicy !== 'required';
}

export function extractExplicitTitle(question: string) {
  const quoted = question.match(/[“\"「『《]([^”\"」』》]{2,240})[”\"」』》]/)?.[1]?.trim();
  if (quoted && !isPaperTitleReference(quoted)) return quoted;
  const direct = question.match(
    /(?:准确|新的?|实际)?\s*(?:标题|title)\s*(?:是|为|改成|改为|修改为|设为|设置为|命名为|is|to)\s*[:：]?\s*(.{2,240})$/i
  )?.[1]?.trim().replace(/[。.!！]+$/, '');
  return direct && !isPaperTitleReference(direct) ? direct : undefined;
}

function isPaperTitleReference(value: string) {
  return /^(?:这篇|该|当前|原文)?\s*(?:论文|paper)(?:的|原始|实际)?\s*(?:标题|title)$/i.test(value);
}
