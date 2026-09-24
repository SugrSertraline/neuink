import { Search, X } from 'lucide-react';
import { Button } from './button';
import { Input } from './input';
import { cn } from '@/lib/utils';

/** Compact collection search with a stable clear-button slot. */
export function SearchInput({ label, placeholder, value, onValueChange, className }: {
  label: string; placeholder: string; value: string; onValueChange: (value: string) => void; className?: string;
}) {
  return <div className={cn('relative min-w-24 flex-1', className)}>
    <Search data-slot="search-input-icon" className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
    <Input className="h-8 pl-8 pr-8 text-xs" aria-label={label} placeholder={placeholder} value={value} onChange={event => onValueChange(event.target.value)} />
    <Button aria-label="清除搜索" title="清除搜索" size="icon-sm" className="absolute right-0.5 top-0.5 text-muted-foreground" variant="ghost" disabled={!value} onClick={() => onValueChange('')}><X size={13} aria-hidden="true" /></Button>
  </div>;
}
