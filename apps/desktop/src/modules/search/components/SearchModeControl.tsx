import { Search, Sparkles } from 'lucide-react';

import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import type { SearchMode } from '@/shared/ipc/workspaceApi';

type SearchModeControlProps = {
  className?: string;
  disabled?: boolean;
  mode: SearchMode;
  onModeChange: (mode: SearchMode) => void;
};

const OPTIONS: Array<{
  icon: typeof Search;
  label: string;
  mode: SearchMode;
}> = [
  {
    icon: Sparkles,
    label: 'Hybrid',
    mode: 'hybrid'
  },
  {
    icon: Search,
    label: 'Keyword',
    mode: 'keyword'
  }
];

export function SearchModeControl({
  className,
  disabled,
  mode,
  onModeChange
}: SearchModeControlProps) {
  return (
    <ToggleGroup
      aria-label="Search mode"
      className={cn('rounded-md border bg-muted p-0.5', className)}
      disabled={disabled}
      size="sm"
      spacing={0}
      type="single"
      value={mode}
      variant="default"
      onValueChange={(value) => {
        if (value === 'hybrid' || value === 'keyword') {
          onModeChange(value);
        }
      }}
    >
      {OPTIONS.map((option) => {
        const Icon = option.icon;
        const selected = mode === option.mode;
        return (
          <ToggleGroupItem
            aria-label={option.label}
            className={cn(
              'h-6 px-2 text-[11px]',
              selected ? 'bg-background shadow-sm hover:bg-background' : 'text-muted-foreground'
            )}
            key={option.mode}
            value={option.mode}
          >
            <Icon size={12} aria-hidden="true" />
            {option.label}
          </ToggleGroupItem>
        );
      })}
    </ToggleGroup>
  );
}
