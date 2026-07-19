import type { EntryTranslation } from '@/shared/ipc/workspaceApi';
import type { SourceSegment } from '@/shared/types/domain';

export function buildTranslationExportTitle(entryTitle: string) {
  return `Translation - ${entryTitle}`;
}

export function buildTranslationExportMarkdown({
  entryTitle,
  sourceSegments,
  translation
}: {
  entryTitle: string;
  sourceSegments: SourceSegment[];
  translation: EntryTranslation;
}) {
  const translatedSegments = sourceSegments
    .map((segment) => ({
      source: segment,
      translation: translation.segments.find(
        (item) => item.segment_uid === segment.uid && item.status === 'translated' && item.translated_text
      )
    }))
    .filter(
      (item): item is { source: SourceSegment; translation: NonNullable<typeof item.translation> } =>
        Boolean(item.translation?.translated_text)
    );

  if (translatedSegments.length === 0) {
    throw new Error('No translated segments available to export.');
  }

  const lines = [
    `# ${buildTranslationExportTitle(entryTitle)}`,
    '',
    '## Summary',
    '',
    `- Source language: ${translation.source_language}`,
    `- Target language: ${translation.target_language}`,
    `- Status: ${translation.status}`,
    `- Progress: translated ${translation.progress.translated} / ${translation.progress.total}, skipped ${translation.progress.skipped}, failed ${translation.progress.failed}`,
    translation.model ? `- Model: ${translation.model}` : null,
    '',
    '## Bilingual Content',
    ''
  ].filter((line): line is string => line !== null);

  for (const { source, translation: translated } of translatedSegments) {
    lines.push(`### 第 ${source.page_idx + 1} 页 · ${source.segment_type} · 原文片段 ${source.uid}`);
    lines.push('');
    lines.push('**Source**');
    lines.push('');
    lines.push(normalizeBlockMarkdown(source.markdown ?? source.text));
    lines.push('');
    lines.push('**Translation**');
    lines.push('');
    lines.push(normalizeBlockMarkdown(translated.translated_text ?? ''));
    lines.push('');
  }

  return ensureTrailingNewline(lines.join('\n').replace(/\n{3,}/g, '\n\n'));
}

function normalizeBlockMarkdown(text: string) {
  const normalized = text.trim();
  return normalized || '_Empty._';
}

function ensureTrailingNewline(markdown: string) {
  const trimmed = markdown.trim();
  return trimmed ? `${trimmed}\n` : '';
}
