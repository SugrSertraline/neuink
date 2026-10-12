import { describe, expect, it, vi } from 'vitest';
import { PdfReadingAudit } from './pdfReading';

const read = (start:number,count:number,extra:Record<string,unknown> = {}) => ({kind:'read_pdf_pages',reading_mode:'pdf_text_layer',
  entry_id:'paper',page_count:21,scanned_start_page:start,scanned_end_page:start+count-1,
  evidence:Array.from({length:count},(_,n) => ({page:start+n,text:'actual evidence',truncated:false})),empty_pages:[],...extra});

describe('PDF reading coverage', () => {
  it('recovers a rejected six-page batch only after both valid batches cover the requested range', () => {
    const recovered = vi.fn(); const audit = new PdfReadingAudit(recovered);
    audit.rejectPageCount('invalid',{entry_id:'paper',start_page:16,page_count:6});
    audit.observe(read(16,5)); expect(recovered).not.toHaveBeenCalled();
    audit.observe(read(21,1)); expect(recovered).toHaveBeenCalledExactlyOnceWith('invalid');
    audit.observe(read(21,1)); expect(recovered).toHaveBeenCalledOnce();
  });
  it('does not recover from another document, missing pages, impossible pages or failed output', () => {
    const recovered = vi.fn(); const audit = new PdfReadingAudit(recovered);
    audit.rejectPageCount('invalid',{entry_id:'paper',start_page:16,page_count:6});
    audit.observe(read(16,5,{entry_id:'other'})); audit.observe(read(21,1));
    audit.observe({ok:false}); audit.observe(read(16,6));
    expect(recovered).not.toHaveBeenCalled();
    audit.rejectPageCount('invalid-input',{entry_id:'paper',start_page:16,page_count:5});
    audit.observe(read(16,5)); expect(recovered).toHaveBeenCalledExactlyOnceWith('invalid');
  });
  it('reports scanned ranges separately from truncation and clears truncation only on a complete reread', () => {
    const audit = new PdfReadingAudit();
    audit.observe(read(1,3,{evidence:[{page:1,text:'text',truncated:false},{page:2,text:'cut',truncated:true}],omitted_pages_due_to_budget:[3]}));
    expect(audit.notice()).toContain('第 1–3 页（共 21 页）');
    expect(audit.notice()).toContain('第 2–3 页正文有截断或省略');
    expect(audit.notice()).toContain('不能据此确认已完整阅读');
    audit.observe(read(2,1)); expect(audit.notice()).toContain('第 3 页正文有截断或省略');
    audit.observe(read(2,1,{evidence:[{page:2,text:'later cut',truncated:true}]}));
    expect(audit.notice()).not.toContain('第 2–3 页正文');
  });
  it('reports empty and separated page ranges without exposing a title or raw result', () => {
    const audit = new PdfReadingAudit(); expect(audit.notice()).toBe('');
    audit.observe(read(1,1,{evidence:[],empty_pages:[1],entry_title:'private title'}));
    audit.observe(read(5,1));
    expect(audit.notice()).toContain('第 1、5 页'); expect(audit.notice()).toContain('第 1 页没有提取到文字');
    expect(audit.notice()).not.toContain('private title');
  });
});
