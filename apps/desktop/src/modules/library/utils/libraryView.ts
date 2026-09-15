export type LibraryView = 'all' | 'recent' | 'parsed' | 'parsing' | 'failed' | 'no_pdf' | 'trash';

// Sidebar navigation and the library page describe the same view.
export const LIBRARY_VIEW_LABELS: Record<LibraryView, string> = {
  all: '全部',
  recent: '最近阅读',
  parsed: '已解析 PDF',
  parsing: '解析中',
  failed: '解析失败',
  no_pdf: '无 PDF',
  trash: '回收站'
};

export function getLibraryViewTitle(view: LibraryView) {
  return view === 'all' ? '全部条目' : LIBRARY_VIEW_LABELS[view];
}
