/** Mirrors the native import mapping for presenting read-only source differences. */
const FIELD_ALIASES: Readonly<Record<string, string>> = {
  authors: '作者', author: '作者', year: '发表年份', doi: 'DOI', publicationTitle: '期刊／会议名称',
  发表载体: '期刊／会议名称', publisher: '出版社', volume: '卷号', issue: '期号', pages: '页码',
  language: '语言', date: '原始发表日期', source_url: '来源链接', pdf_source_url: 'PDF 来源',
  research_id: '检索文献 ID', zotero_editor: '编辑', zotero_translator: '译者', abstract: 'description',
};
export function normalizeSourceFields(input: Record<string, string>): Record<string, string> {
  const fields = { ...input };
  for (const [source, target] of Object.entries(FIELD_ALIASES)) {
    if (!(source in fields)) continue;
    const value = fields[source], current = fields[target];
    if (current?.trim() && value.trim() && current.trim() !== value.trim()) continue;
    if (!current?.trim()) fields[target] = value;
    delete fields[source];
  }
  return fields;
}
