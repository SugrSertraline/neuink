import { PanelRightOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export function SplitNoteButton({ title, disabled, onClick }: { title: string; disabled?: boolean; onClick: () => void }) {
  return <Tooltip><TooltipTrigger asChild><Button aria-label={`分屏打开 ${title}`} size="icon-xs" variant="ghost" disabled={disabled} onClick={onClick}>
    <PanelRightOpen size={13} aria-hidden="true" />
  </Button></TooltipTrigger><TooltipContent>分屏打开笔记</TooltipContent></Tooltip>;
}
