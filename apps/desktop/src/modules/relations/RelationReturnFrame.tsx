import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Keep the content wrapper stable so revealing a return link never remounts an editor. */
export function RelationReturnFrame({ visible, onReturn, children }: { visible: boolean; onReturn: () => void; children: ReactNode }) {
  return <div className="flex h-full min-h-0 min-w-0 flex-col">
    <div hidden={!visible} className="shrink-0 border-b bg-card px-2 py-1"><Button size="xs" variant="ghost" onClick={onReturn}><ArrowLeft size={13} />返回关系图</Button></div>
    <div className="min-h-0 min-w-0 flex-1 overflow-hidden">{children}</div>
  </div>;
}
