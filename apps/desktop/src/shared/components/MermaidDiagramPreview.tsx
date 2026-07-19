import { Loader2 } from 'lucide-react';
import { useEffect, useId, useState } from 'react';

import { cn } from '@/lib/utils';

let mermaidInitialized = false;
let mermaidApi: (typeof import('mermaid'))['default'] | null = null;

export function MermaidDiagramPreview({
  code,
  compact = false,
  className,
}: {
  code: string;
  compact?: boolean;
  className?: string;
}) {
  const id = useId().replace(/:/g, '-');
  const [renderState, setRenderState] = useState<
    | { status: 'error'; message: string }
    | { status: 'loading' }
    | { status: 'ready'; svg: string }
  >({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setRenderState({ status: 'loading' });
    void renderMermaidDiagram(`${id}-${Date.now()}`, code).then(
      (svg) => {
        if (!cancelled) {
          setRenderState({ status: 'ready', svg });
        }
      },
      (caught) => {
        if (!cancelled) {
          setRenderState({
            status: 'error',
            message: caught instanceof Error ? caught.message : String(caught),
          });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [code, id]);

  if (renderState.status === 'loading') {
    return (
      <div className={cn('flex min-h-32 items-center justify-center gap-2 text-sm text-muted-foreground', className)}>
        <Loader2 className="animate-spin" size={16} aria-hidden="true" />
        正在渲染 Mermaid 图…
      </div>
    );
  }

  if (renderState.status === 'error') {
    return (
      <pre className={cn('whitespace-pre-wrap break-words rounded-md border border-destructive/30 bg-destructive/5 p-3 font-mono text-xs text-destructive', className)}>
        Mermaid 渲染失败：{renderState.message}
      </pre>
    );
  }

  return (
    <div
      className={cn(
        'overflow-auto rounded-md border bg-white p-3 [&_svg]:mx-auto [&_svg]:max-w-full',
        compact && 'p-2 [&_svg]:max-h-72',
        className,
      )}
      dangerouslySetInnerHTML={{ __html: renderState.svg }}
    />
  );
}

async function renderMermaidDiagram(id: string, code: string) {
  if (!mermaidApi) {
    mermaidApi = (await import('mermaid')).default;
  }
  if (!mermaidInitialized) {
    mermaidApi.initialize({
      securityLevel: 'strict',
      startOnLoad: false,
      theme: 'neutral',
    });
    mermaidInitialized = true;
  }
  const { svg } = await mermaidApi.render(`neuink-mermaid-${id}`, code);
  return svg;
}
