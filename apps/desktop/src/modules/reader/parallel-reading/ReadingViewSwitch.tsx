import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export type ReadingView = 'current' | 'compare' | 'note';
export type ReadingViewSwitchProps = { value: ReadingView; currentTitle?: string; compareTitle?: string; noteTitle?: string; onChange: (value: ReadingView) => void };
export function ReadingViewSwitch({ value, currentTitle, compareTitle, noteTitle, onChange }: ReadingViewSwitchProps) {
  return <Select value={value} onValueChange={(next) => onChange(next as ReadingView)}>
    <SelectTrigger size="sm" className="w-[100px] shrink-0 text-xs" aria-label={noteTitle === undefined ? '切换主读或对照论文' : '切换阅读区域'}><SelectValue /></SelectTrigger>
    <SelectContent position="popper" align="start" className="max-w-[calc(100vw-2rem)]">
      {currentTitle !== undefined ? <SelectItem value="current" title={currentTitle}>主读论文</SelectItem> : null}
      {compareTitle !== undefined ? <SelectItem value="compare" title={compareTitle}>对照论文</SelectItem> : null}
      {noteTitle !== undefined ? <SelectItem value="note" title={noteTitle}>文档笔记</SelectItem> : null}
    </SelectContent>
  </Select>;
}
