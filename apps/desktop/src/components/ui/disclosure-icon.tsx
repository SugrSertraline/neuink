import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/** The parent control owns expansion and keyboard behavior; the frame keeps a fixed light direction. */
export function DisclosureIcon({ open, size = 13, className }: { open?: boolean; size?: number; className?: string }) {
  return <span aria-hidden="true" className="inline-flex shrink-0" data-material="disclosure-control">
    <ChevronRight size={size} data-material="disclosure-icon" className={cn(open && 'rotate-90', className)} />
  </span>;
}
