import { FileSearch2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function LocateSourceButton({ disabled, label = '定位原文', title = label, onClick, className }: {
  disabled?: boolean;
  label?: string;
  title?: string;
  onClick: () => void;
  className?: string;
}) {
  return <Button aria-label={label} title={title} disabled={disabled} className={className} size="xs" type="button" variant="outline" onClick={onClick}>
    <FileSearch2 aria-hidden="true" className="size-3.5 shrink-0" />{label}
  </Button>;
}
