import { AlertTriangle, Eye, EyeOff, Hammer, Loader2, RefreshCw } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Command, CommandInput } from '@/components/ui/command';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import {
  rebuildSearchIndex,
  type SearchIndexBuildStatus,
  type SearchHit,
  type SearchMode
} from '@/shared/ipc/workspaceApi';
import { useToast } from '@/shared/hooks/useToast';

import { useEmbeddingStatus } from '../hooks/useEmbeddingStatus';
import { useGlobalSearch } from '../hooks/useGlobalSearch';
import { useSearchIndexStatus } from '../hooks/useSearchIndexStatus';
import { EmbeddingStatusLine } from './EmbeddingStatusLine';
import { SearchIndexStatusLine } from './SearchIndexStatusLine';
import { SearchModeControl } from './SearchModeControl';
import { SearchResultList } from './SearchResultList';
import { AppearanceCommand, isAppearanceCommand } from './AppearanceCommand';

type SearchPanelProps = {
  buildStatus?: SearchIndexBuildStatus | null;
  root: string | null;
  status: 'loading' | 'ready' | 'error';
  onOpenResult: (hit: SearchHit) => void;
  onOpenSetting?: (id: string) => void;
};

export function SearchPanel({ buildStatus = null, root, status, onOpenResult, onOpenSetting }: SearchPanelProps) {
  const [query, setQuery] = useState('');
  const appearanceCommand = isAppearanceCommand(query);
  const [mode, setMode] = useState<SearchMode>('hybrid');
  const [hoverPreviewEnabled, setHoverPreviewEnabled] = useState(true);
  const [rebuildRequested, setRebuildRequested] = useState(false);
  const [buildConfirmOpen, setBuildConfirmOpen] = useState(false);
  const { notify } = useToast();
  const { busy, error, results } = useGlobalSearch({ root, status, query: appearanceCommand ? '' : query, mode });
  const semanticMode = mode === 'hybrid' || mode === 'semantic';
  const { embeddingError, embeddingStatus } = useEmbeddingStatus(
    semanticMode && Boolean(root) && status === 'ready'
  );
  const {
    searchIndexError,
    searchIndexStatus,
    setSearchIndexError,
    setSearchIndexStatus
  } = useSearchIndexStatus({
    enabled: semanticMode && Boolean(root) && status === 'ready',
    refreshKey: `${busy ? 'busy' : 'idle'}:${results?.index_generation ?? 0}:${results?.mode ?? mode}:${buildStatus?.updated_at_ms ?? 0}`,
    root
  });
  const canRebuild =
    semanticMode &&
    Boolean(root) &&
    status === 'ready' &&
    Boolean(searchIndexStatus?.semantic_document_count);
  const needsBuild = searchIndexStatus?.semantic_status === 'needs_build';
  const pendingVectorCount = searchIndexStatus?.semantic_document_count ?? 0;
  const rebuilding =
    rebuildRequested || buildStatus?.state === 'queued' || buildStatus?.state === 'running';
  const buildProgress = buildStatus && buildStatus.total > 0
    ? Math.round((buildStatus.completed / buildStatus.total) * 100)
    : 0;

  const rebuildVectors = async () => {
    if (!root || !canRebuild || rebuilding) {
      return;
    }
    setRebuildRequested(true);
    setSearchIndexError(null);
    try {
      const response = await rebuildSearchIndex(root);
      setSearchIndexStatus(response.status);
      notify({
        tone: 'success',
        title: needsBuild ? '向量索引已构建' : '向量索引已更新',
        description: `已处理 ${response.rebuilt_vector_count} 个向量。`
      });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setSearchIndexError(message);
      notify({ tone: 'danger', title: '构建向量索引失败', description: message });
    } finally {
      setRebuildRequested(false);
    }
  };

  const confirmBuild = () => {
    setBuildConfirmOpen(false);
    void rebuildVectors();
  };

  return (
    <aside className="app-sidebar">
      <div className="side-head">
        <span>搜索</span>
        {busy ? <Loader2 className="animate-spin text-muted-foreground" size={15} aria-hidden="true" /> : null}
      </div>

      <Command
        label="搜索资料"
        data-material="sidebar-canvas"
        className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] rounded-none p-0"
        filter={() => 1}
        shouldFilter={false}
        onKeyDownCapture={event => {
          if (event.key === 'Enter' && event.nativeEvent.isComposing) event.stopPropagation();
        }}
      >
        <div className="min-w-0 border-b p-2" data-material="sidebar-toolbar">
          <CommandInput
            autoFocus
            aria-label="搜索资料"
            placeholder="搜索标题、Tag、Note、PDF Segment"
            value={query}
            onValueChange={setQuery}
          />
          {!appearanceCommand ? <><div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
            <span className="shrink-0 text-[11px] font-semibold text-muted-foreground">模式</span>
            <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-1.5">
              <Button
                aria-pressed={hoverPreviewEnabled}
                className="shrink-0"
                size="xs"
                title={hoverPreviewEnabled ? '关闭悬停预览' : '开启悬停预览'}
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
              <SearchModeControl
                disabled={!root || status !== 'ready'}
                mode={mode}
                onModeChange={setMode}
              />
            </div>
          </div>
          <EmbeddingStatusLine
            className="mt-1.5"
            error={embeddingError}
            mode={mode}
            status={embeddingStatus}
          />
          <div className="mt-1 flex min-w-0 items-start justify-between gap-2">
            <SearchIndexStatusLine
              buildStatus={buildStatus}
              className="min-w-0 flex-1"
              error={searchIndexError}
              mode={mode}
              status={searchIndexStatus}
            />
            {canRebuild ? (
              <Button
                className="shrink-0"
                disabled={rebuilding}
                size="xs"
                title={needsBuild ? '构建向量索引' : '增量更新向量索引'}
                type="button"
                variant="ghost"
                onClick={() => setBuildConfirmOpen(true)}
              >
                {rebuilding ? (
                  <Loader2 className="animate-spin" size={12} aria-hidden="true" />
                ) : needsBuild ? (
                  <Hammer size={12} aria-hidden="true" />
                ) : (
                  <RefreshCw size={12} aria-hidden="true" />
                )}
                {needsBuild ? '构建' : '更新'}
              </Button>
            ) : null}
          </div>
          {buildStatus?.state === 'queued' || buildStatus?.state === 'running' ? (
            <Progress
              aria-label="向量索引构建进度"
              className="mt-1 h-1.5"
              value={buildProgress}
            />
          ) : null}
          {error ? (
            <div className="mt-2 min-w-0 max-w-full overflow-hidden break-words rounded-md border border-destructive/25 bg-destructive/5 px-2.5 py-2 text-xs leading-5 text-destructive">
              {error}
            </div>
          ) : null}</> : null}
        </div>

        {appearanceCommand ? <AppearanceCommand onExecuted={() => setQuery('')} /> : <SearchResultList
          settingsQuery={query}
          onOpenSetting={onOpenSetting}
          className="h-full min-h-0"
          hoverPreviewEnabled={hoverPreviewEnabled}
          results={results}
          root={root}
          onOpenResult={onOpenResult}
        />}
      </Command>

      <Dialog open={buildConfirmOpen} onOpenChange={setBuildConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle size={16} aria-hidden="true" />
              {needsBuild ? '构建向量索引' : '更新向量索引'}
            </DialogTitle>
            <DialogDescription>
              {needsBuild
                ? `将为 ${pendingVectorCount} 条内容生成语义向量，用于语义与混合搜索。`
                : '将为新增或变更的内容补充语义向量，通常只需几秒到几十秒。'}
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm leading-6 text-amber-800 dark:text-amber-200">
            构建过程会占用大量 CPU，应用可能暂时卡顿；首次构建可能需要数分钟。构建期间关键词搜索不受影响，可随时继续使用。
          </div>
          <DialogFooter>
            <Button disabled={rebuilding} type="button" variant="outline" onClick={() => setBuildConfirmOpen(false)}>
              取消
            </Button>
            <Button disabled={rebuilding} type="button" onClick={confirmBuild}>
              <Hammer size={14} aria-hidden="true" />
              {needsBuild ? '开始构建' : '开始更新'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
