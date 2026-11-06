/** Keep real source markers on every continuation; no characters are silently sampled away. */
export function splitPaperCardChunks(document: string, budget: number): string[] {
  if (!Number.isFinite(budget) || budget < 256) throw new Error('模型上下文不足以整理卡片，请提高上下文长度。');
  const blocks = document.split(/(?=^\[S\d+\] segment_uid: )/m).filter(Boolean);
  const chunks: string[] = [];
  let current = '';
  for (const block of blocks) {
    const marker = block.match(/^\[S\d+\] segment_uid: [^\r\n]+\r?\n/)?.[0] ?? '';
    if (marker.length > budget / 2) throw new Error('论文来源标记过长。');
    const body = block.slice(marker.length);
    const capacity = Math.floor(budget - marker.length - 1);
    for (let offset = 0; offset < Math.max(1, body.length);) {
      let end = Math.min(body.length, offset + capacity);
      if (end < body.length) {
        const part = body.slice(offset, end), boundaries = [...part.matchAll(/[。！？.!?]\s|\n/g)];
        const last = boundaries[boundaries.length - 1];
        if (last && last.index! > capacity / 2) end = offset + last.index! + last[0].length;
        if (/[\uD800-\uDBFF]/.test(body[end - 1])) end--;
      }
      const piece = marker + body.slice(offset, end);
      if (current && current.length + piece.length + 1 > budget) { chunks.push(current); current = ''; }
      current += (current ? '\n' : '') + piece;
      if (end === body.length) break;
      offset = end;
    }
  }
  if (current) chunks.push(current);
  if (chunks.length > 100) throw new Error('论文需要超过 100 批整理，请提高模型上下文长度后重试。');
  return chunks;
}
