import { Check, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ReaderSection } from './ReaderSurfacePrimitives';
import { useEntryTagSuggestions } from './pdf-reader/useEntryTagSuggestions';
import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';

export function EntryTagRecommendations({ entry, workspaceRoot, onApplyEntryTagPaths }: {
  entry: LibraryEntry; workspaceRoot: string | null;
  onApplyEntryTagPaths?: (entryId: string, paths: string[]) => Promise<unknown> | unknown;
}) {
  const suggestions = useEntryTagSuggestions({ entry, workspaceRoot, onApplyEntryTagPaths: onApplyEntryTagPaths ?? (() => undefined) });
  return <ReaderSection className="entry-overview-section" title="推荐标签"
    description={suggestions.generatedAt ? '已保留本次生成结果。重新生成时才会替换；添加标签不会清除结果。' : '根据论文内容生成推荐，已有标签不影响生成。'}
    actions={<Button variant="outline" size="sm" disabled={suggestions.busy || Boolean(suggestions.disabledReason)} title={suggestions.disabledReason ?? undefined} onClick={() => void suggestions.generate()}>
      {suggestions.phase === 'generating' ? <Loader2 size={13} className="animate-spin" /> : suggestions.generatedAt ? <RefreshCw size={13} /> : null}
      {suggestions.phase === 'generating' ? '正在生成…' : suggestions.generatedAt ? '重新生成' : '生成推荐标签'}
    </Button>}>
    {suggestions.recommendations.length ? <div className="flex flex-wrap gap-2">{suggestions.recommendations.map(tag => {
      const applied = entry.tags.includes(tag.path), selected = suggestions.selectedPaths.has(tag.path);
      return <Button key={tag.path} size="sm" variant={selected || applied ? 'secondary' : 'outline'} className="h-auto min-w-0 max-w-full whitespace-normal py-1.5 text-left"
        aria-pressed={selected || applied} disabled={suggestions.busy || applied} title={tag.reason || tag.path} aria-label={`${tag.path}${applied ? '，已添加' : ''}`}
        onClick={() => suggestions.toggleRecommendation(tag)}>
        {selected || applied ? <Check size={12} className="shrink-0" /> : null}<span className="min-w-0 break-words">{tag.path}</span>{applied ? <span className="shrink-0 text-xs text-muted-foreground">已添加</span> : null}
      </Button>;
    })}</div> : <p className="text-sm text-muted-foreground">{suggestions.generatedAt ? '本次分析没有生成推荐标签，可以重新生成。' : '尚未生成推荐标签。'}</p>}
    {suggestions.disabledReason ? <p className="mt-2 text-xs text-muted-foreground">{suggestions.disabledReason}</p> : null}
    {suggestions.error ? <p role="alert" className="mt-2 text-sm text-destructive">{suggestions.error}</p> : null}
    {suggestions.recommendations.length ? <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
      <span className="text-xs text-muted-foreground">选择要添加的标签，已有关联保持不变。</span>
      <Button size="sm" disabled={suggestions.busy || !suggestions.canApply || !onApplyEntryTagPaths} onClick={() => void suggestions.apply()}>{suggestions.phase === 'applying' ? '添加中…' : '添加所选标签'}</Button>
    </div> : null}
  </ReaderSection>;
}
