import { Checkbox as CheckboxPrimitive } from 'radix-ui';
import { Check } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export function Checkbox({ className, ...props }: ComponentProps<typeof CheckboxPrimitive.Root>) {
  return <CheckboxPrimitive.Root
    data-slot="checkbox"
    className={cn('peer size-4 shrink-0 rounded-sm border border-input bg-background outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground', className)}
    {...props}
  >
    <CheckboxPrimitive.Indicator data-slot="checkbox-indicator" className="grid place-items-center"><Check aria-hidden="true" className="size-3.5" /></CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>;
}
