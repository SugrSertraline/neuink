import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { alignSavedTranslation, splitAcademicSentences } from '../src/modules/reader/translation/sentenceAlignment.ts';

const dataDirectory = path.resolve(process.env.NEUINK_DEV_DATA_DIR || 'D:\\NeuInk\\data');
const entriesDirectory = path.join(dataDirectory, 'library', 'entries');
if (!existsSync(entriesDirectory)) {
  console.error(`找不到资料目录：${entriesDirectory}`);
  process.exit(1);
}

let translatedParagraphs = 0;
let alignedParagraphs = 0;
let alignedSentences = 0;
const failures = [];
for (const entryId of readdirSync(entriesDirectory, { withFileTypes: true })
  .filter(entry => entry.isDirectory()).map(entry => entry.name)) {
  const translationPath = path.join(entriesDirectory, entryId, 'paper.translation.json');
  if (!existsSync(translationPath)) continue;
  const translations = JSON.parse(readFileSync(translationPath, 'utf8'));
  for (const segment of translations.segments ?? []) {
    if (segment.segment_type !== 'paragraph' || segment.status !== 'translated' ||
      !segment.source_text?.trim() || !segment.translated_text?.trim()) continue;
    translatedParagraphs++;
    const aligned = alignSavedTranslation(segment.source_text, segment.translated_text);
    if (aligned) {
      alignedParagraphs++;
      alignedSentences += aligned.length;
    } else {
      failures.push({ entryId, segmentUid: segment.segment_uid, page: segment.page_idx + 1,
        sourceSentences: splitAcademicSentences(segment.source_text).length,
        translationSentences: splitAcademicSentences(segment.translated_text, true).length });
    }
  }
}

console.log(`资料目录：${dataDirectory}`);
console.log(`已翻译段落：${translatedParagraphs}；可逐句配对：${alignedParagraphs}；配对句组：${alignedSentences}`);
if (failures.length) console.log(JSON.stringify(failures, null, 2));
process.exitCode = failures.length ? 1 : 0;
