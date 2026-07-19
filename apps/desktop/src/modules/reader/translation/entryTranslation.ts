import { generateText } from 'ai';

import { getLlmSettings, readEntryAssistantContext } from '@/shared/ipc/assistantApi';
import {
  beginEntryTranslation,
  finishEntryTranslation,
  readEntryTranslation,
  saveTranslationContext,
  upsertTranslatedSegments,
  type EntryTranslation,
  type TranslatedSegment,
  type TranslationTerm
} from '@/shared/ipc/workspaceApi';
import type { SourceSegment } from '@/shared/types/domain';

import { createNeuinkModel, generationSettings } from '../../assistant/sdk/provider';

const MAX_PAPER_CONTEXT_BUDGET = 28_000;
const MAX_BATCH_CHAR_BUDGET = 7_500;
const MAX_BATCH_SEGMENTS = 8;

export type TranslationProgressUpdate = {
  detail?: string | null;
  message: string;
  phase: 'batch' | 'complete' | 'context' | 'partial' | 'preparing' | 'reuse' | 'skipping';
  translation: EntryTranslation | null;
};

export type TranslationRunStrategy = 'restart' | 'resume';

export async function translateTextSelection({
  context,
  entryTitle,
  text
}: {
  context?: string | null;
  entryTitle: string;
  text: string;
}) {
  const sourceText = text.trim();
  if (!sourceText) {
    throw new Error('没有可翻译的文字。');
  }
  const settings = await getLlmSettings();
  const profile = settings.translation_profile;
  if (!profile) {
    throw new Error('请先在模型设置里配置翻译模型。');
  }

  const result = await generateText({
    ...generationSettings(profile),
    model: createNeuinkModel(profile),
    system: [
      'You are an academic paper translator.',
      'Translate the selected text into Simplified Chinese.',
      'Preserve formulas, citations, numbers, abbreviations, code, and technical symbols.',
      'Return the translation only. Do not return JSON, explanations, labels, or markdown fences.'
    ].join('\n'),
    prompt: [
      `Paper title: ${entryTitle}`,
      context?.trim()
        ? `Paragraph context:\n${trimToBudget(context.trim(), translationBudgets(profile.max_context_length).context)}`
        : null,
      `Selected text:\n${sourceText}`
    ].filter(Boolean).join('\n\n')
  });
  const translatedText = result.text.trim();
  if (!translatedText) {
    throw new Error('翻译模型没有返回可用译文。');
  }
  return translatedText;
}

export async function translateEntrySegments({
  entryId,
  entryTitle,
  onProgress,
  root,
  strategy = 'resume',
  segments
}: {
  entryId: string;
  entryTitle: string;
  onProgress?: (update: TranslationProgressUpdate) => void;
  root: string;
  strategy?: TranslationRunStrategy;
  segments: SourceSegment[];
}) {
  const settings = await getLlmSettings();
  const profile = settings.translation_profile;
  if (!profile) {
    throw new Error('请先在模型设置里配置全文翻译模型。');
  }

  const candidates = segments.filter(shouldTranslateSegment);
  const skipped = segments.filter((segment) => !shouldTranslateSegment(segment));
  const expectedTotal = candidates.length + skipped.length;
  const previous = await readEntryTranslation(root, entryId);
  const shouldRestart =
    strategy === 'restart' ||
    !previous.translation ||
    previous.translation.progress.total !== expectedTotal;
  const restartedBecauseShapeChanged =
    strategy === 'resume' &&
    Boolean(previous.translation) &&
    previous.translation?.progress.total !== expectedTotal;

  let response = shouldRestart
    ? await beginEntryTranslation(root, entryId, {
        model: profile.model,
        total: expectedTotal
      })
    : await finishEntryTranslation(root, entryId, 'running');

  onProgress?.({
    detail: restartedBecauseShapeChanged
      ? 'Segment 数量变化，已重新开始全文翻译'
      : shouldRestart
        ? '开始新的全文翻译任务'
        : '继续未完成任务，并跳过已完成且原文未变化的 Segment',
    message: '准备论文背景',
    phase: 'preparing',
    translation: response.translation
  });

  const existingBySegmentUid = new Map(
    (response.translation?.segments ?? []).map((segment) => [segment.segment_uid, segment])
  );
  const pendingCandidates = candidates.filter(
    (segment) => !isReusableTranslatedSegment(segment, existingBySegmentUid.get(segment.uid))
  );
  const reusedCount = candidates.length - pendingCandidates.length;

  if (reusedCount > 0) {
    onProgress?.({
      detail: `${reusedCount} 个 Segment 已有可复用译文`,
      message: '已复用既有译文',
      phase: 'reuse',
      translation: response.translation
    });
  }

  if (skipped.length > 0) {
    response = await upsertTranslatedSegments(
      root,
      entryId,
      skipped.map((segment) => ({
        page_idx: segment.page_idx,
        segment_type: segment.segment_type,
        segment_uid: segment.uid,
        source_hash: sourceHash(sourceText(segment)),
        source_text: sourceText(segment),
        status: 'skipped',
        translated_text: null
      }))
    );
    onProgress?.({
      detail: `${skipped.length} 个 Segment 已标记为跳过`,
      message: '已跳过不适合翻译的区域',
      phase: 'skipping',
      translation: response.translation
    });
  }

  if (pendingCandidates.length === 0) {
    response = await finishEntryTranslation(
      root,
      entryId,
      response.translation?.progress.failed ? 'partial' : 'succeeded'
    );
    const completedWithFailures = Boolean(response.translation?.progress.failed);
    onProgress?.({
      detail: completedWithFailures
        ? `${response.translation?.progress.failed ?? 0} 个 Segment 仍未完成`
        : '没有需要重新翻译的 Segment',
      message: completedWithFailures ? '翻译部分完成' : '翻译已是最新',
      phase: completedWithFailures ? 'partial' : 'complete',
      translation: response.translation
    });
    return response.translation;
  }

  const model = createNeuinkModel(profile);
  const generationOptions = generationSettings(profile);
  const budgets = translationBudgets(profile.max_context_length);
  const paperContext = response.translation?.paper_context
    ? {
        summary: response.translation.paper_context.summary,
        terminology: response.translation.paper_context.terminology
      }
    : await buildPaperContextFromEntry({
        entryId,
        entryTitle,
        contextBudget: budgets.context,
        generationOptions,
        model,
        root,
        segments
      });

  if (response.translation?.paper_context) {
    onProgress?.({
      detail: '沿用上次生成的论文背景和术语表',
      message: '已复用论文背景',
      phase: 'context',
      translation: response.translation
    });
  } else {
    response = await saveTranslationContext(root, entryId, paperContext);
    onProgress?.({
      detail: '开始按 Segment 批量翻译',
      message: '论文背景已生成',
      phase: 'context',
      translation: response.translation
    });
  }

  const batches = buildTranslationBatches(pendingCandidates, budgets.batch);
  try {
    for (let index = 0; index < batches.length; index += 1) {
      const batch = batches[index];
      onProgress?.({
        detail: `${batch.length} 个 Segment`,
        message: `翻译批次 ${index + 1}/${batches.length}`,
        phase: 'batch',
        translation: response.translation
      });
      const translated = await translateBatch({
        batch,
        entryTitle,
        generationOptions,
        model,
        paperContext
      });
      response = await upsertTranslatedSegments(
        root,
        entryId,
        batch.map((segment) => {
          const text = translated.get(segment.uid)?.trim();
          return {
            error: text ? null : '模型未返回该 segment 的译文',
            page_idx: segment.page_idx,
            segment_type: segment.segment_type,
            segment_uid: segment.uid,
            source_hash: sourceHash(sourceText(segment)),
            source_text: sourceText(segment),
            status: text ? 'translated' : 'failed',
            translated_text: text || null
          };
        })
      );
      onProgress?.({
        detail: `${batch.length} 个 Segment 已写入翻译结果`,
        message: `翻译中 ${index + 1}/${batches.length}`,
        phase: 'batch',
        translation: response.translation
      });
    }
  } catch (error) {
    response = await finishEntryTranslation(root, entryId, 'partial', errorMessage(error));
    onProgress?.({
      detail: errorMessage(error),
      message: '翻译部分完成',
      phase: 'partial',
      translation: response.translation
    });
    throw error;
  }

  response = await finishEntryTranslation(
    root,
    entryId,
    response.translation?.progress.failed ? 'partial' : 'succeeded'
  );
  const completedWithFailures = Boolean(response.translation?.progress.failed);
  onProgress?.({
    detail: completedWithFailures
      ? `${response.translation?.progress.failed ?? 0} 个 Segment 失败`
      : '所有可翻译 Segment 已处理',
    message: completedWithFailures
      ? '翻译部分完成'
      : '翻译完成',
    phase: completedWithFailures ? 'partial' : 'complete',
    translation: response.translation
  });
  return response.translation;
}

async function buildPaperContextFromEntry({
  contextBudget,
  entryId,
  entryTitle,
  generationOptions,
  model,
  root,
  segments
}: {
  contextBudget: number;
  entryId: string;
  entryTitle: string;
  generationOptions: ReturnType<typeof generationSettings>;
  model: ReturnType<typeof createNeuinkModel>;
  root: string;
  segments: SourceSegment[];
}) {
  const entryContext = await readEntryAssistantContext({ entryId, root });
  return buildPaperContext({
    contextBudget,
    documentMarkdown: entryContext.markdown,
    entryTitle,
    generationOptions,
    model,
    segments
  });
}

function isReusableTranslatedSegment(segment: SourceSegment, existing?: TranslatedSegment) {
  return (
    existing?.status === 'translated' &&
    existing.source_hash === sourceHash(sourceText(segment)) &&
    Boolean(existing.translated_text?.trim())
  );
}

function shouldTranslateSegment(segment: SourceSegment) {
  const text = sourceText(segment).trim();
  if (text.length < 2) {
    return false;
  }
  if (
    segment.segment_type === 'figure' ||
    segment.segment_type === 'math' ||
    segment.segment_type === 'page_header' ||
    segment.segment_type === 'page_footer' ||
    segment.segment_type === 'page_number' ||
    segment.segment_type === 'aside_text' ||
    segment.segment_type === 'page_footnote'
  ) {
    return false;
  }
  if (looksLikeReference(text)) {
    return false;
  }
  if (looksLikeFormulaOnly(text)) {
    return false;
  }
  return true;
}

async function buildPaperContext({
  contextBudget,
  entryTitle,
  documentMarkdown,
  generationOptions,
  model,
  segments
}: {
  contextBudget: number;
  documentMarkdown: string;
  entryTitle: string;
  generationOptions: ReturnType<typeof generationSettings>;
  model: ReturnType<typeof createNeuinkModel>;
  segments: SourceSegment[];
}) {
  const markdown = trimToBudget(
    documentMarkdown.trim() ||
      segments
        .filter((segment) => segment.segment_type !== 'figure')
        .map((segment) => sourceText(segment))
        .join('\n\n'),
    contextBudget
  );
  const result = await generateText({
    ...generationOptions,
    model,
    system:
      'You prepare context for academic paper translation. Return strict JSON only: {"summary":"...","terminology":[{"source":"...","target":"...","note":null}]}. Do not translate the full paper.',
    prompt: `Paper title: ${entryTitle}

Read the parsed Markdown below. Identify the paper background, research problem, method/data terms, abbreviations, and translation conventions. Output Chinese summary and terminology pairs.

Parsed Markdown:
${markdown}`
  });
  const parsed = parseJsonObject<{
    summary?: unknown;
    terminology?: Array<{ note?: string | null; source?: string; target?: string }>;
  }>(result.text);

  return {
    summary: typeof parsed.summary === 'string' ? parsed.summary.trim() : '',
    terminology: normalizeTerms(parsed.terminology ?? [])
  };
}

async function translateBatch({
  batch,
  entryTitle,
  generationOptions,
  model,
  paperContext
}: {
  batch: SourceSegment[];
  entryTitle: string;
  generationOptions: ReturnType<typeof generationSettings>;
  model: ReturnType<typeof createNeuinkModel>;
  paperContext: { summary: string; terminology: TranslationTerm[] };
}) {
  const result = await generateText({
    ...generationOptions,
    model,
    system: [
      'You are an academic paper translator.',
      'Translate source segments into Simplified Chinese.',
      'Preserve formulas, citations, numbers, code, markdown tables, and technical symbols.',
      'Keep inline math wrapped in $...$ and never insert spaces around LaTeX _, ^, braces, or commands.',
      'Do not split math symbols or subscripts across lines; write $M_i$, $d_i$, $\\Phi_{\\mathrm{test}}$ compactly.',
      'Use $$...$$ for long display equations; do not wrap equations in Chinese brackets like 【...】.',
      'Do not translate references or image placeholders.',
      'Return strict JSON only: {"segments":[{"segment_uid":"...","translated_text":"..."}]}.',
      'Return one translation per segment_uid only.'
    ].join('\n'),
    prompt: `Paper title: ${entryTitle}

Paper context:
${paperContext.summary}

Terminology:
${paperContext.terminology
  .slice(0, 40)
  .map((term) => `- ${term.source} => ${term.target}${term.note ? ` (${term.note})` : ''}`)
  .join('\n') || 'None'}

Translate these segments:
${batch
  .map(
    (segment) => `<segment uid="${segment.uid}" type="${segment.segment_type}" page="${segment.page_idx + 1}">
${sourceText(segment)}
</segment>`
  )
  .join('\n\n')}`
  });
  const parsed = parseJsonObject<{
    segments?: Array<{ segment_uid?: string; translated_text?: string }>;
  }>(result.text);

  return new Map(
    (parsed.segments ?? [])
      .filter(
        (segment): segment is { segment_uid: string; translated_text: string } =>
          typeof segment.segment_uid === 'string' &&
          typeof segment.translated_text === 'string'
      )
      .map((segment) => [segment.segment_uid, segment.translated_text])
  );
}

function buildTranslationBatches(segments: SourceSegment[], charBudget = MAX_BATCH_CHAR_BUDGET) {
  const batches: SourceSegment[][] = [];
  let current: SourceSegment[] = [];
  let currentChars = 0;

  for (const segment of segments) {
    const length = sourceText(segment).length;
    if (
      current.length > 0 &&
      (current.length >= MAX_BATCH_SEGMENTS || currentChars + length > charBudget)
    ) {
      batches.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(segment);
    currentChars += length;
  }

  if (current.length > 0) {
    batches.push(current);
  }

  return batches;
}

function translationBudgets(maxContextLength: number | null) {
  const estimatedContextChars = Math.max(12_000, (maxContextLength ?? 8_192) * 3);
  return {
    batch: Math.min(MAX_BATCH_CHAR_BUDGET, Math.max(2_000, Math.floor(estimatedContextChars * 0.25))),
    context: Math.min(
      MAX_PAPER_CONTEXT_BUDGET,
      Math.max(4_000, Math.floor(estimatedContextChars * 0.35))
    )
  };
}

function sourceText(segment: SourceSegment) {
  return segment.markdown ?? segment.text;
}

function looksLikeReference(text: string) {
  const compact = text.trim();
  return /^(references|bibliography|参考文献)\b/i.test(compact);
}

function looksLikeFormulaOnly(text: string) {
  const compact = text.replace(/\s+/g, '');
  if (compact.length === 0) {
    return true;
  }
  const symbolCount = (compact.match(/[=+\-*/^_{}()[\]$\\<>≤≥≈∑∫√]/g) ?? []).length;
  return symbolCount >= Math.max(4, compact.length * 0.35) && compact.length < 220;
}

function trimToBudget(text: string, budget: number) {
  if (text.length <= budget) {
    return text;
  }
  return `${text.slice(0, budget)}\n\n[Truncated]`;
}

function normalizeTerms(terms: Array<{ note?: string | null; source?: string; target?: string }>) {
  return terms
    .map((term) => ({
      note: term.note?.trim() || null,
      source: term.source?.trim() ?? '',
      target: term.target?.trim() ?? ''
    }))
    .filter((term) => term.source && term.target)
    .slice(0, 80);
}

function sourceHash(text: string) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function parseJsonObject<T>(text: string): T {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? trimmed;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end < start) {
    throw new Error('模型没有返回有效 JSON。');
  }
  return JSON.parse(candidate.slice(start, end + 1)) as T;
}
