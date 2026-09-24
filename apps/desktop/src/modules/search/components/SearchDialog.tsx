import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Command,
  CommandDialog,
  CommandInput
} from '@/components/ui/command';
import type { SearchHit, SearchMode } from '@/shared/ipc/workspaceApi';

import { useEmbeddingStatus } from '../hooks/useEmbeddingStatus';
import { useGlobalSearch } from '../hooks/useGlobalSearch';
import { useSearchIndexBuildStatus } from '../hooks/useSearchIndexBuildStatus';
import { useSearchIndexStatus } from '../hooks/useSearchIndexStatus';
import { EmbeddingStatusLine } from './EmbeddingStatusLine';
import { SearchIndexStatusLine } from './SearchIndexStatusLine';
import { SearchModeControl } from './SearchModeControl';
import { SearchResultList } from './SearchResultList';
import { AppearanceCommand, isAppearanceCommand } from './AppearanceCommand';

type SearchDialogProps = {
  open: boolean;
  root: string | null;
  status: 'loading' | 'ready' | 'error';
  onOpenChange: (open: boolean) => void;
  onOpenResult: (hit: SearchHit) => void;
  onOpenSetting?: (id: string) => void;
};

export function SearchDialog({
  open,
  root,
  status,
  onOpenChange,
  onOpenResult,
  onOpenSetting
}: SearchDialogProps) {
  const [query, setQuery] = useState('');
  const appearanceCommand = isAppearanceCommand(query);
  const [mode, setMode] = useState<SearchMode>('hybrid');
  const [hoverPreviewEnabled, setHoverPreviewEnabled] = useState(true);
  const { busy, error, results } = useGlobalSearch({
    root,
    status,
    query: appearanceCommand ? '' : query,
    mode,
    limit: 80
  });
  const semanticMode = mode === 'hybrid' || mode === 'semantic';
  const { embeddingError, embeddingStatus } = useEmbeddingStatus(
    open && semanticMode && Boolean(root) && status === 'ready'
  );
  const { searchIndexBuildStatus } = useSearchIndexBuildStatus({
    enabled: open && Boolean(root) && status === 'ready',
    root
  });
  const { searchIndexError, searchIndexStatus } = useSearchIndexStatus({
    enabled: open && semanticMode && Boolean(root) && status === 'ready',
    refreshKey: `${busy ? 'busy' : 'idle'}:${results?.index_generation ?? 0}:${results?.mode ?? mode}:${searchIndexBuildStatus?.updated_at_ms ?? 0}`,
    root
  });

  useEffect(() => {
    if (!open) {
      setQuery('');
    }
  }, [open]);

  const openResult = (hit: SearchHit) => {
    onOpenResult(hit);
    onOpenChange(false);
  };

  return (
    <CommandDialog
      className="top-[18vh] h-[min(720px,76vh)] max-h-[calc(100vh-2rem)] max-w-3xl translate-y-0 grid-rows-[minmax(0,1fr)] gap-0 rounded-lg shadow-2xl sm:max-w-3xl"
      description="搜索条目、标签、笔记、原文片段和设置"
      open={open}
      title="全局搜索"
      onOpenChange={onOpenChange}
    >
      <Command
        label="全局搜索"
        className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] rounded-none p-0"
        filter={() => 1}
        shouldFilter={false}
        onKeyDownCapture={event => {
          if (event.key === 'Enter' && event.nativeEvent.isComposing) event.stopPropagation();
        }}
      >
        <div className="border-b bg-popover p-3">
          <CommandInput
            autoFocus
            className="pr-8"
            aria-label="全局搜索"
            placeholder="搜索资料或设置，如：翻译、缩放"
            value={query}
            onValueChange={setQuery}
          />
          {!appearanceCommand && busy ? (
            <Loader2
              className="absolute right-6 top-6 size-4 animate-spin text-muted-foreground"
              aria-hidden="true"
            />
          ) : null}
          {!appearanceCommand ? <div className="mt-2 flex items-center justify-between gap-2">
            <Button
              aria-pressed={hoverPreviewEnabled}
              size="xs"
              title={hoverPreviewEnabled ? '关闭鼠标悬停查看' : '开启鼠标悬停查看'}
              type="button"
              variant={hoverPreviewEnabled ? 'secondary' : 'ghost'}
              onClick={() => setHoverPreviewEnabled((enabled) => !enabled)}
            >
              {hoverPreviewEnabled ? (
                <Eye size={12} aria-hidden="true" />
              ) : (
                <EyeOff size={12} aria-hidden="true" />
              )}
              悬停预览
            </Button>
            <div className="flex items-center justify-end">
              <SearchModeControl
                disabled={!root || status !== 'ready'}
                mode={mode}
                onModeChange={setMode}
              />
            </div>
          </div>
          : null}
          {!appearanceCommand ? <><EmbeddingStatusLine
            className="mt-1.5 justify-end"
            error={embeddingError}
            mode={mode}
            status={embeddingStatus}
          />
          <SearchIndexStatusLine
            buildStatus={searchIndexBuildStatus}
            className="mt-1 justify-end"
            error={searchIndexError}
            mode={mode}
            status={searchIndexStatus}
          />
          {error ? (
            <div className="mt-2 rounded-md border border-destructive/25 bg-destructive/5 px-2.5 py-2 text-xs leading-5 text-destructive">
              {error}
            </div>
          ) : null}</> : null}
        </div>

        <div className="min-h-0 overflow-hidden">
          {appearanceCommand ? <AppearanceCommand onExecuted={() => { setQuery(''); onOpenChange(false); }} /> : <SearchResultList
            settingsQuery={query}
            onOpenSetting={onOpenSetting ? id => { onOpenSetting(id); onOpenChange(false); } : undefined}
            className="h-full min-h-0"
            hoverPreviewEnabled={hoverPreviewEnabled}
            results={results}
            root={root}
            onOpenResult={openResult}
          />}
        </div>
      </Command>
    </CommandDialog>
  );
}
