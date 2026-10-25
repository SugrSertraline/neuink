const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const page = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 2000;

/** Reading coverage describes returned evidence, not model comprehension or image interpretation. */
export class PdfReadingAudit {
  private entries = new Map<string, { total: number; scanned: Set<number>; partial: Set<number>; complete: Set<number>; empty: Set<number> }>();
  private rejected = new Map<string, { entry: string; start: number; end: number }>();
  constructor(private recovered: (id: string) => void = () => undefined) {}

  rejectPageCount(id: string, input: unknown) {
    const value = object(input);
    const start = value.start_page ?? 1, count = value.page_count;
    // Only a known no-side-effect page-count validation error can be recovered this way.
    if (typeof value.entry_id !== 'string' || !page(start) || !Number.isInteger(count) || Number(count) <= 5 || Number(count) > 2000) return;
    this.rejected.set(id, {entry:value.entry_id,start,end:Math.min(2000,start + Number(count) - 1)});
    this.resolve();
  }

  observe(output: unknown) {
    const value = object(output);
    if (value.kind !== 'read_pdf_pages' || value.reading_mode !== 'pdf_text_layer' || typeof value.entry_id !== 'string'
      || !page(value.page_count) || !page(value.scanned_start_page) || !page(value.scanned_end_page)
      || value.scanned_end_page < value.scanned_start_page || value.scanned_end_page > value.page_count
      || value.scanned_end_page - value.scanned_start_page >= 5 || !Array.isArray(value.evidence)) return;
    const state = this.entries.get(value.entry_id) ?? {total:value.page_count,scanned:new Set<number>(),partial:new Set<number>(),complete:new Set<number>(),empty:new Set<number>()};
    state.total = value.page_count;
    for (let n = value.scanned_start_page; n <= value.scanned_end_page; n++) state.scanned.add(n);
    for (const evidence of value.evidence.map(object)) {
      if (!page(evidence.page) || typeof evidence.text !== 'string' || !evidence.text.trim()) continue;
      if (evidence.truncated === false) { state.complete.add(evidence.page); state.partial.delete(evidence.page); }
      else if (!state.complete.has(evidence.page)) state.partial.add(evidence.page);
    }
    for (const n of Array.isArray(value.omitted_pages_due_to_budget) ? value.omitted_pages_due_to_budget : []) {
      if (page(n) && !state.complete.has(n)) state.partial.add(n);
    }
    for (const n of Array.isArray(value.empty_pages) ? value.empty_pages : []) if (page(n)) state.empty.add(n);
    this.entries.set(value.entry_id,state);
    this.resolve();
  }

  private resolve() {
    for (const [id, request] of this.rejected) {
      const state = this.entries.get(request.entry);
      if (!state || request.end > state.total) continue;
      if (Array.from({length:request.end-request.start+1},(_,n) => n+request.start).every(n => state.scanned.has(n))) {
        this.rejected.delete(id); this.recovered(id);
      }
    }
  }

  notice(): string {
    if (!this.entries.size) return '';
    const reports = [...this.entries.values()].map(state => {
      const ranges = formatPages(state.scanned);
      const partial = state.partial.size ? `；第 ${formatPages(state.partial)} 页正文有截断或省略` : '';
      const empty = state.empty.size ? `；第 ${formatPages(state.empty)} 页没有提取到文字` : '';
      return `本轮已扫描第 ${ranges} 页（共 ${state.total} 页）${partial}${empty}`;
    });
    return `读取说明：${reports.join('；另一份 PDF：')}。这是 PDF 基础文字层读取，图片、表格和公式可能缺失或不准确，不能据此确认已完整阅读全部内容。`;
  }
}

function formatPages(values: Set<number>): string {
  const pages = [...values].sort((a,b) => a-b);
  const ranges: string[] = [];
  for (let at = 0; at < pages.length; at++) {
    const start = pages[at]; let end = start;
    while (pages[at + 1] === end + 1) end = pages[++at];
    ranges.push(start === end ? String(start) : `${start}–${end}`);
  }
  return ranges.join('、');
}
