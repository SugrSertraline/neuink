import { createPointerDropSession } from '@/shared/lib/pointerDropSession';
import type { CardKind } from '@/shared/ipc/ideationApi';

export type IdeationDragItem = { workspaceRoot: string; boardId: string; data: string; title: string; kind: CardKind; x: number; y: number };
// The shared session overwrites x/y with live client coordinates, including on release.
const session = createPointerDropSession<IdeationDragItem>();
export const ideationCardDrag = { ...session, finish: (x: number, y: number) => { session.update(x, y); return session.finish(x, y); } };
