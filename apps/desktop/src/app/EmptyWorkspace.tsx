import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import type { WorkspaceSurface } from './workspaceSurface';

export function EmptyWorkspace({ onOpen }: { onOpen: (surface: WorkspaceSurface) => void }) {
  return <Empty className="h-full rounded-none bg-card" aria-label="空工作区">
    <EmptyHeader>
      <EmptyTitle>选择一个页面开始</EmptyTitle>
      <EmptyDescription>查看每日阅读，或从条目库打开论文。</EmptyDescription>
    </EmptyHeader>
    <div className="flex flex-wrap justify-center gap-2">
      <Button onClick={() => onOpen({ kind: 'daily-dashboard' })}>打开每日看板</Button>
      <Button variant="outline" onClick={() => onOpen({ kind: 'library' })}>打开条目库</Button>
    </div>
  </Empty>;
}
