import { NodeViewContent, NodeViewWrapper } from '@tiptap/react';

import { cn } from '@/lib/utils';

import type { CalloutVariant } from './CalloutBlock';

type CalloutBlockViewProps = {
  node: {
    attrs: {
      variant?: CalloutVariant | null;
    };
  };
  selected: boolean;
};

export function CalloutBlockView({ node, selected }: CalloutBlockViewProps) {
  const theme = calloutTheme(normalizeCalloutVariant(node.attrs.variant));

  return (
    <NodeViewWrapper
      className={cn(
        'my-3 block border-y border-r border-l-4 bg-white transition-colors',
        theme.root,
        selected && 'ring-1 ring-ring/20'
      )}
      data-callout-block="true"
    >
      <NodeViewContent className="px-3 py-2.5 text-sm leading-6 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0" />
    </NodeViewWrapper>
  );
}

function normalizeCalloutVariant(value?: string | null): CalloutVariant {
  switch (value) {
    case 'warning':
    case 'success':
    case 'error':
    case 'tip':
      return value;
    default:
      return 'info';
  }
}

function calloutTheme(variant: CalloutVariant) {
  switch (variant) {
    case 'warning':
      return {
        root: 'border-l-amber-400 border-r-slate-200 border-y-slate-200'
      };
    case 'success':
      return {
        root: 'border-l-emerald-400 border-r-slate-200 border-y-slate-200'
      };
    case 'error':
      return {
        root: 'border-l-rose-400 border-r-slate-200 border-y-slate-200'
      };
    case 'tip':
      return {
        root: 'border-l-sky-400 border-r-slate-200 border-y-slate-200'
      };
    case 'info':
    default:
      return {
        root: 'border-l-slate-400 border-r-slate-200 border-y-slate-200'
      };
  }
}
