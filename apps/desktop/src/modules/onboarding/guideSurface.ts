import { surfaceKey, type WorkspaceSurfaceLayout } from '@/app/workspaceSurface';
import type { GuideStep } from './catalog';

/** Resolve only a visible view of the bound teaching object; never borrow another pane. */
export function guideSurfaceKey(step: GuideStep, layout: WorkspaceSurfaceLayout,
  entryId: string | null, noteId: string | null): string | null | undefined {
  if (!step.targetSurface) return undefined;
  const panes = step.targetPane ? [step.targetPane]
    : layout.focusedPane === 'right' ? ['right', 'left'] as const : ['left', 'right'] as const;
  for (const pane of panes) {
    const surface = layout[pane];
    if (surface?.kind !== step.targetSurface || !('entryId' in surface) || surface.entryId !== entryId) continue;
    if (surface.kind === 'note' && surface.noteId !== noteId) continue;
    return surfaceKey(surface);
  }
  return null;
}
