import { useMemo } from 'react';

type DiffLine = { kind: 'same' | 'removed' | 'added'; text: string };

function readableText(html: string): string {
  const document = new DOMParser().parseFromString(html, 'text/html');
  const walk = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
    if (!(node instanceof Element)) return '';
    if (node.tagName === 'BR') return '\n';
    const content = Array.from(node.childNodes, walk).join('');
    return /^(DIV|P|H[1-6]|LI|TR|BLOCKQUOTE|PRE)$/.test(node.tagName) ? `${content}\n` : content;
  };
  return Array.from(document.body.childNodes, walk).join('').replace(/\u00a0/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function lineDiff(before: string, after: string): { lines: DiffLine[]; approximate: boolean; removed: number; added: number } {
  const left = before.split('\n');
  const right = after.split('\n');
  if (left.length > 400 || right.length > 400) {
    let prefix = 0;
    while (prefix < Math.min(left.length, right.length) && left[prefix] === right[prefix]) prefix++;
    let suffix = 0;
    while (suffix < Math.min(left.length, right.length) - prefix && left[left.length - 1 - suffix] === right[right.length - 1 - suffix]) suffix++;
    const removed = left.slice(prefix, left.length - suffix);
    const added = right.slice(prefix, right.length - suffix);
    return { lines: [...removed.map(text => ({ kind: 'removed' as const, text })), ...added.map(text => ({ kind: 'added' as const, text }))], approximate: true, removed: removed.length, added: added.length };
  }
  const width = right.length + 1;
  const dp = new Uint16Array((left.length + 1) * width);
  for (let i = left.length - 1; i >= 0; i--) for (let j = right.length - 1; j >= 0; j--)
    dp[i * width + j] = left[i] === right[j] ? 1 + dp[(i + 1) * width + j + 1] : Math.max(dp[(i + 1) * width + j], dp[i * width + j + 1]);
  const lines: DiffLine[] = [];
  let i = 0, j = 0, removed = 0, added = 0;
  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i] === right[j]) { lines.push({ kind: 'same', text: left[i++] }); j++; }
    else if (i < left.length && (j === right.length || dp[(i + 1) * width + j] >= dp[i * width + j + 1])) { lines.push({ kind: 'removed', text: left[i++] }); removed++; }
    else { lines.push({ kind: 'added', text: right[j++] }); added++; }
  }
  return { lines, approximate: false, removed, added };
}

export function ZoteroNoteChangePreview({ beforeHtml, afterHtml }: { beforeHtml: string; afterHtml: string }) {
  const comparison = useMemo(() => {
    const before = readableText(beforeHtml);
    const after = readableText(afterHtml);
    return { before, after, diff: lineDiff(before, after), htmlChanged: beforeHtml !== afterHtml };
  }, [beforeHtml, afterHtml]);
  const visibleDiff = comparison.diff.lines.filter((line, index, lines) => line.kind !== 'same' ||
    lines.slice(Math.max(0, index - 2), Math.min(lines.length, index + 3)).some(near => near.kind !== 'same'));
  return <div className="space-y-2 text-xs">
    <p className="font-medium">变化摘要：{comparison.diff.removed} 行删除，{comparison.diff.added} 行新增{comparison.diff.approximate ? '（长笔记按连续变更范围估算）' : ''}。</p>
    {comparison.diff.removed === 0 && comparison.diff.added === 0 && comparison.htmlChanged ? <p className="text-warning">文字相同，但 HTML 排版、链接或结构不同；替换仍会改写 Zotero 笔记。</p> : null}
    <div className="grid gap-2 sm:grid-cols-2">
      <section aria-label="Zotero 原笔记" className="min-w-0 rounded-md border border-border bg-muted p-2"><h3 className="mb-1 font-medium">Zotero 原笔记</h3><pre className="max-h-44 overflow-auto whitespace-pre-wrap break-words font-sans text-muted-foreground">{comparison.before || '空笔记'}</pre></section>
      <section aria-label="拟写入 Zotero 的内容" className="min-w-0 rounded-md border border-border bg-muted p-2"><h3 className="mb-1 font-medium">拟写入 Zotero</h3><pre className="max-h-44 overflow-auto whitespace-pre-wrap break-words font-sans text-foreground">{comparison.after || '空笔记'}</pre></section>
    </div>
    {visibleDiff.length > 0 ? <section aria-label="逐行变化" className="max-h-40 overflow-auto rounded-md border border-border p-2 font-mono">
      {visibleDiff.slice(0, 300).map((line, index) => <p key={index} className={line.kind === 'removed' ? 'bg-destructive/10 text-destructive' : line.kind === 'added' ? 'bg-primary/10 text-primary' : 'text-muted-foreground'}><span aria-hidden="true">{line.kind === 'removed' ? '− ' : line.kind === 'added' ? '+ ' : '  '}</span>{line.text || ' '}</p>)}
      {visibleDiff.length > 300 ? <p className="text-muted-foreground">更多变化请在上方两栏中查看完整内容。</p> : null}
    </section> : null}
    {comparison.htmlChanged ? <details className="rounded-md border border-border p-2"><summary className="cursor-pointer font-medium">查看排版与链接的原始 HTML</summary><div className="mt-2 grid gap-2 sm:grid-cols-2"><pre className="max-h-32 min-w-0 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2">{beforeHtml}</pre><pre className="max-h-32 min-w-0 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2">{afterHtml}</pre></div></details> : null}
  </div>;
}
