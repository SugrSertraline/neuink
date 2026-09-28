import { memo } from 'react';
import { MermaidDiagramPreview } from '@/shared/components/MermaidDiagramPreview';

// Read-only output. Never render an incomplete streaming diagram on every token.
// The message owns scrolling; only large diagrams/source blocks scroll internally.
export const AssistantDiagramBlock = memo(function AssistantDiagramBlock({ code, streaming }: {
  code: string;
  streaming: boolean;
}) {
  return <section aria-label="助手图表" className="my-3 min-w-0 space-y-2">
    {streaming ? <p role="status" className="text-sm text-muted-foreground">正在生成图表，回复完成后显示预览…</p>
      : <MermaidDiagramPreview code={code} className="max-h-[32rem] overscroll-contain" />}
    <details className="text-xs text-muted-foreground">
      <summary className="cursor-pointer rounded-sm py-1 focus-visible:outline focus-visible:outline-ring">查看图表源码</summary>
      <pre className="max-h-64 overflow-auto overscroll-contain"><code className="language-mermaid">{code}</code></pre>
    </details>
  </section>;
});
