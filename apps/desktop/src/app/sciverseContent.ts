import { readSciverseContent } from '../modules/sciverse/api/sciverseApi';

export async function readAllSciversePaperContent(docId: string) {
  const chunks: string[] = [];
  let offset = 0;
  const maxPages = 256;
  for (let page = 0; page < maxPages; page += 1) {
    // /content rewrites some image references after slicing; a boundary inside
    // such a reference can leave a duplicate filename tail in the next slice.
    // Prefer its documented complete response for a saved offline article.
    const response = await readSciverseContent(page === 0
      ? { doc_id: docId }
      : { doc_id: docId, limit: 16_000, offset });
    // Offsets are exact character slices. Trimming or inserting paragraph breaks
    // here can split an image path, formula, word, or Markdown delimiter.
    chunks.push(response.text);
    if (!response.more) return { text: chunks.join(''), truncated: false };
    if (response.next_offset <= offset) throw new Error('Sciverse 正文分页未推进，已停止保存。');
    offset = response.next_offset;
  }
  return { text: chunks.join(''), truncated: true };
}
