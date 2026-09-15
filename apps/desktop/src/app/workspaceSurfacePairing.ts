import { surfaceNoteTarget, type WorkspaceSurface } from './workspaceSurface';

export type WorkspaceReaderSurfaceKind = 'pdf' | 'reflow';

export type WorkspaceSurfacePairRelation =
  | 'independent'
  | 'reader-sync'
  | 'record-sync'
  | 'citation'
  | 'backlink-navigation'
  | 'source-navigation';

export type WorkspaceSurfacePairing = {
  left: WorkspaceSurface;
  relation: WorkspaceSurfacePairRelation;
  right: WorkspaceSurface;
  sameEntry: boolean;
};

export function resolveWorkspaceSurfacePair(
  left: WorkspaceSurface,
  right: WorkspaceSurface
): WorkspaceSurfacePairing {
  const sameEntry = surfaceEntryId(left) !== null && surfaceEntryId(left) === surfaceEntryId(right);
  const leftReader = readerKind(left);
  const rightReader = readerKind(right);
  let relation: WorkspaceSurfacePairRelation = 'independent';

  if (sameEntry && leftReader && rightReader && leftReader !== rightReader) {
    relation = 'reader-sync';
  } else if (
    sameEntry &&
    ((leftReader && right.kind === 'segment-notes') ||
      (rightReader && left.kind === 'segment-notes'))
  ) {
    relation = 'record-sync';
  } else if (
    (leftReader && surfaceNoteTarget(right)) ||
    (rightReader && surfaceNoteTarget(left))
  ) {
    // A note may intentionally collect evidence from another entry.
    relation = 'citation';
  } else if (
    (left.kind === 'source-links' && surfaceNoteTarget(right)) ||
    (right.kind === 'source-links' && surfaceNoteTarget(left))
  ) {
    relation = 'backlink-navigation';
  } else if (
    sameEntry &&
    ((left.kind === 'source-links' && rightReader) ||
      (right.kind === 'source-links' && leftReader))
  ) {
    relation = 'source-navigation';
  }

  return { left, relation, right, sameEntry };
}

export function readerKind(surface: WorkspaceSurface | null): WorkspaceReaderSurfaceKind | null {
  return surface?.kind === 'pdf' || surface?.kind === 'reflow' ? surface.kind : null;
}

export function workspaceSurfacePairRelationLabel(relation: WorkspaceSurfacePairRelation) {
  switch (relation) {
    case 'reader-sync': return '阅读位置双向联动';
    case 'record-sync': return '原文与片段记录联动';
    case 'citation': return '原文与笔记引用联动';
    case 'backlink-navigation': return '引用清单与笔记导航联动';
    case 'source-navigation': return '引用清单与原文定位联动';
    case 'independent': return null;
  }
}

function surfaceEntryId(surface: WorkspaceSurface) {
  return 'entryId' in surface ? surface.entryId : null;
}
