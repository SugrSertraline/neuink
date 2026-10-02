import { useRef } from 'react';
import { BookPlus, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ConversationSourceLink, SciverseLibraryImportResult } from '@/shared/ipc/assistantApi';
import { useSciverseImportState } from './ResearchPaperActions';

export function SciverseImportButton({
  onImport,
  source
}: {
  onImport: (
    source: Extract<ConversationSourceLink, { provider: 'sciverse' }>
  ) => Promise<SciverseLibraryImportResult>;
  source: Extract<ConversationSourceLink, { provider: 'sciverse' }>;
}) {
  const [state, setState] = useSciverseImportState(source.doc_id);
  const inFlight = useRef(false);
  const confirm = () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setState({ status: 'loading' });
    void onImport(source).then(result => setState({ result, status: 'done' }))
      .catch(error => setState({ message: error instanceof Error ? error.message : String(error), status: 'error' }))
      .finally(() => { inFlight.current = false; });
  };
  const label =
    state.status === 'loading'
      ? '正在加入…'
      : state.status === 'done'
        ? state.result.status === 'created_with_pdf'
          ? '已加入并解析'
          : state.result.status === 'created_with_remote_content'
            ? '已保存远程全文'
          : state.result.status === 'already_exists'
            ? '已在文库'
            : '已加入（元数据）'
        : '一键加入文库';

  return (
    <div className="min-w-0 max-w-full">
      <Button
        className="h-auto min-h-7 max-w-full whitespace-normal text-left"
        disabled={state.status === 'loading' || state.status === 'done' || state.status === 'confirm'}
        size="sm"
        title={state.status === 'error' ? state.message : undefined}
        type="button"
        variant="outline"
        onClick={() => setState({ status: 'confirm' })}
      >
        {state.status === 'loading' ? (
          <Loader2 className="animate-spin" size={11} aria-hidden="true" />
        ) : (
          <BookPlus size={11} aria-hidden="true" />
        )}
        {label}
      </Button>
      {state.status === 'confirm' && <div className="mt-2 grid gap-2 rounded border bg-muted p-2 text-sm">
        <p>确认将《{source.title}》加入本地文库？优先下载 PDF 并开始解析；无法获取 PDF 时尝试保存远程全文或元数据。</p>
        <div className="flex flex-wrap gap-2"><Button size="sm" variant="ghost" onClick={() => setState({ status: 'idle' })}>取消</Button>
          <Button size="sm" onClick={confirm}>确认添加</Button></div>
      </div>}
      {state.status === 'done' && <p role="status" className="mt-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">{state.result.message}</p>}
      {state.status === 'error' ? (
        <div role="alert" className="mt-1 text-sm text-destructive [overflow-wrap:anywhere]">
          {state.message}
        </div>
      ) : null}
    </div>
  );
}
