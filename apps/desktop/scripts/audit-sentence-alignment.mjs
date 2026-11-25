import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { alignSavedTranslation, splitAcademicSentences, sentenceAlignmentFailureReason } from '../src/modules/reader/translation/sentenceAlignment.ts';

const dataDirectory = path.resolve(process.env.NEUINK_DEV_DATA_DIR || fileURLToPath(new URL('../../../portable/data', import.meta.url)));
const entriesDirectory = path.join(dataDirectory, 'library', 'entries');
if (!existsSync(entriesDirectory)) {
  console.error(`找不到资料目录：${entriesDirectory}`);
  process.exit(1);
}

let translatedParagraphs = 0;
let alignedParagraphs = 0;
let alignedSentences = 0;
const failures = [];
const reasons = {};
let translatedEntries = 0, unreadableFiles = 0, failedTranslations = 0;
const uniqueFailures = new Set();
for (const entryId of readdirSync(entriesDirectory, { withFileTypes: true })
  .filter(entry => entry.isDirectory()).map(entry => entry.name)) {
  const translationPath = path.join(entriesDirectory, entryId, 'paper.translation.json');
  if (!existsSync(translationPath)) continue;
  let translations;
  try { translations = JSON.parse(readFileSync(translationPath, 'utf8')); }
  catch { unreadableFiles++; continue; }
  translatedEntries++;
  for (const segment of translations.segments ?? []) {
    if (segment.status === 'failed') failedTranslations++;
    if (segment.segment_type !== 'paragraph' || segment.status !== 'translated' ||
      !segment.source_text?.trim() || !segment.translated_text?.trim()) continue;
    translatedParagraphs++;
    const aligned = alignSavedTranslation(segment.source_text, segment.translated_text);
    if (aligned) {
      alignedParagraphs++;
      alignedSentences += aligned.length;
    } else {
      const reason = sentenceAlignmentFailureReason(segment.source_text, segment.translated_text);
      reasons[reason] = (reasons[reason] ?? 0) + 1;
      // Count duplicate saved paragraphs without writing their text to the report.
      uniqueFailures.add(JSON.stringify([segment.source_text, segment.translated_text]));
      failures.push({ entryId, segmentUid: segment.segment_uid, page: segment.page_idx + 1,
        reason,
        sourceSentences: splitAcademicSentences(segment.source_text).length,
        translationSentences: splitAcademicSentences(segment.translated_text, true).length });
    }
  }
}

console.log(`资料目录：${dataDirectory}`);
console.log(`已翻译段落：${translatedParagraphs}；可逐句配对：${alignedParagraphs}；配对句组：${alignedSentences}`);
console.log(`译文文件：${translatedEntries}；无法读取：${unreadableFiles}；保存状态为翻译失败的片段：${failedTranslations}`);
console.log(`对齐失败：${failures.length}；涉及条目：${new Set(failures.map(item => item.entryId)).size}；去重样例：${uniqueFailures.size}`);
console.log(`对齐限制分类（非译文质量判定）：${JSON.stringify(reasons)}`);
if (failures.length) console.log(JSON.stringify(failures, null, 2));
process.exitCode = failures.length ? 1 : 0;
