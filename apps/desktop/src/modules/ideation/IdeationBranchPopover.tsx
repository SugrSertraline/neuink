import type { ReactElement } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverAnchor, PopoverArrow, PopoverContent } from '@/components/ui/popover';
import type { CardKind } from '@/shared/ipc/ideationApi';
import { branchRules } from './ideationBranches';

export function IdeationBranchPopover({ children, kind, open, activeRule, container, onChoose, onClose }: {
  children: ReactElement; kind: CardKind; open: boolean; activeRule?: string;
  container: HTMLElement | null; onChoose: (id: string) => void; onClose: () => void;
}) {
  return <Popover open={open} modal={false}>
    <PopoverAnchor asChild>{children}</PopoverAnchor>
    <PopoverContent container={container} viewportAligned side="bottom" align="start" sideOffset={12} collisionPadding={{ top: 12, bottom: 64, left: 12, right: 12 }}
      collisionBoundary={container} updatePositionStrategy="always" hideWhenDetached
      aria-label="选择下一步" className="w-[272px] gap-2 p-2" onOpenAutoFocus={event => event.preventDefault()}
      onCloseAutoFocus={event => event.preventDefault()} onInteractOutside={event => event.preventDefault()}
      onEscapeKeyDown={event => { event.preventDefault(); event.stopPropagation(); onClose(); }}>
      <p className="px-2 text-xs font-medium text-muted-foreground">选择下一步</p>
      <div className="grid grid-cols-2 gap-1">{branchRules[kind].map(rule => <Button key={rule.id} size="sm" variant={activeRule === rule.id ? 'secondary' : 'ghost'} className="justify-start px-2" aria-label={`分支选项：${rule.title}`} aria-pressed={activeRule === rule.id} onClick={() => onChoose(rule.id)}>{rule.title}</Button>)}</div>
      <PopoverArrow className="fill-popover" />
    </PopoverContent>
  </Popover>;
}
