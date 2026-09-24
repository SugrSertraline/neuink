import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

/** Read-only enlargement; no editor session and no write/approval action. */
export function AssistantContentPreview({ title, label, children, description }: {
  title: string; label: string; children: ReactNode; description?: string;
}) {
  const [open, setOpen] = useState(false);
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button size="sm" variant="outline" className="h-auto max-w-full whitespace-normal py-1 text-sm">{label}</Button></DialogTrigger>
    <DialogContent layout="bounded" className="max-w-[48rem] sm:max-w-[48rem]">
      <DialogHeader className="pr-7"><DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description ?? '只读预览，不会写入或修改笔记。'}</DialogDescription>
      </DialogHeader>
      <DialogBody className="text-base leading-7">{open ? children : null}</DialogBody>
    </DialogContent>
  </Dialog>;
}
