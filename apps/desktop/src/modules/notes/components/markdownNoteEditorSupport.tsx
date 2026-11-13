import { preferredScrollBehavior } from '@/shared/lib/motionPolicy';
import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';

import type { SourceLink } from '@/shared/types/domain';

import { findSourceLinkForSegment } from '../editor/SourceLinkNode';

export function findDirectChildBlock(target: EventTarget | null, root: HTMLElement) {
  if (!(target instanceof Node)) {
    return null;
  }

  let current: HTMLElement | null =
    target instanceof HTMLElement ? target : target.parentElement;

  while (current && current.parentElement !== root) {
    current = current.parentElement;
  }

  if (!current || current.parentElement !== root) {
    return null;
  }

  const index = Array.from(root.children).indexOf(current);
  if (index < 0) {
    return null;
  }

  return {
    element: current,
    index
  };
}

export function findBlockByVerticalPosition(root: HTMLElement, clientY: number) {
  const children = Array.from(root.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement
  );

  for (let index = 0; index < children.length; index += 1) {
    const element = children[index];
    const rect = element.getBoundingClientRect();
    if (clientY >= rect.top && clientY <= rect.bottom) {
      return {
        element,
        index
      };
    }
  }

  return null;
}

export function getBlockVisualRect(element: HTMLElement) {
  const blockRect = element.getBoundingClientRect();
  const range = document.createRange();
  range.selectNodeContents(element);
  const contentRect = range.getBoundingClientRect();
  range.detach();

  if (contentRect.width > 1 && contentRect.height > 1) {
    return contentRect;
  }

  return blockRect;
}

export function findTableFromTarget(target: EventTarget | null) {
  if (!(target instanceof Node)) {
    return null;
  }
  const element = target instanceof HTMLElement ? target : target.parentElement;
  if (element?.closest('[data-neuink-datatable="true"]')) {
    return null;
  }
  const table = element?.closest('table');
  return table instanceof HTMLTableElement ? table : null;
}

export function tableAnchorPos(editor: Editor, table: HTMLTableElement, clientX?: number, clientY?: number) {
  const fallbackElement = table.querySelector('th,td') ?? table;
  const fallbackRect = fallbackElement.getBoundingClientRect();
  const coords = {
    left: clientX ?? fallbackRect.left + Math.min(12, fallbackRect.width / 2),
    top: clientY ?? fallbackRect.top + Math.min(12, fallbackRect.height / 2)
  };
  const pos = editor.view.posAtCoords(coords);
  if (pos) {
    return pos.pos;
  }
  try {
    return editor.view.posAtDOM(fallbackElement, 0);
  } catch {
    return null;
  }
}

export function focusTableAt(editor: Editor, anchorPos: number) {
  const resolvedPos = editor.state.doc.resolve(anchorPos);
  const selection = TextSelection.near(resolvedPos);
  editor.view.dispatch(editor.state.tr.setSelection(selection));
}

export type BlockDropLayout = {
  bottom: number;
  top: number;
};

export function resolveDropTargetFromLayout(layout: BlockDropLayout[], pointerY: number) {
  if (layout.length === 0) {
    return null;
  }

  const firstRect = layout[0];
  if (firstRect && pointerY <= firstRect.top + (firstRect.bottom - firstRect.top) / 2) {
    return {
      targetIndex: 0,
      top: firstRect.top
    };
  }

  for (let index = 0; index < layout.length; index += 1) {
    const rect = layout[index];
    if (!rect) {
      continue;
    }

    if (pointerY <= rect.bottom) {
      const before = pointerY < rect.top + (rect.bottom - rect.top) / 2;
      return {
        targetIndex: before ? index : index + 1,
        top: before ? rect.top : rect.bottom
      };
    }
  }

  const lastRect = layout[layout.length - 1];
  if (!lastRect) {
    return null;
  }

  return {
    targetIndex: layout.length,
    top: lastRect.bottom
  };
}

export function resolveDropTarget(children: HTMLElement[], clientY: number) {
  return resolveDropTargetFromLayout(
    children.map((child) => {
      const rect = child.getBoundingClientRect();
      return { bottom: rect.bottom, top: rect.top };
    }),
    clientY
  );
}

export function reorderTopLevelBlocks(editor: Editor, sourceIndex: number, targetIndex: number) {
  const { doc } = editor.state;
  const childCount = doc.childCount;
  if (
    sourceIndex < 0 ||
    sourceIndex >= childCount ||
    targetIndex < 0 ||
    targetIndex > childCount
  ) {
    return;
  }

  const adjustedTarget = targetIndex > sourceIndex ? targetIndex - 1 : targetIndex;
  if (adjustedTarget === sourceIndex) {
    return;
  }

  const nodes = Array.from({ length: childCount }, (_, index) => doc.child(index));
  const moved = nodes[sourceIndex];
  if (!moved) {
    return;
  }

  const sourcePos = nodes
    .slice(0, sourceIndex)
    .reduce((position, node) => position + node.nodeSize, 0);
  const remainingNodes = nodes.filter((_, index) => index !== sourceIndex);
  const insertPos = remainingNodes
    .slice(0, adjustedTarget)
    .reduce((position, node) => position + node.nodeSize, 0);
  const tr = editor.state.tr.delete(sourcePos, sourcePos + moved.nodeSize).insert(insertPos, moved);

  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(insertPos + 1, tr.doc.content.size))));
  editor.view.dispatch(tr.scrollIntoView());
  editor.view.focus();
}

export function sanitizeExportFileName(value: string) {
  return value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 120) || '笔记';
}

export function revealInsertedSourceLink(scrollElement: HTMLDivElement | null, anchorId: string) {
  window.requestAnimationFrame(() => {
    const root = scrollElement?.querySelector('.tiptap');
    if (!(root instanceof HTMLElement)) {
      return;
    }

    const target = Array.from(root.querySelectorAll('[data-source-link-anchor-id]')).find(
      (element) => element.getAttribute('data-source-link-anchor-id') === anchorId
    );
    if (!(target instanceof HTMLElement)) {
      return;
    }

    target.scrollIntoView({ behavior: preferredScrollBehavior(), block: 'center', inline: 'nearest' });
    target.classList.add('source-link-inserted-flash');
    window.setTimeout(() => target.classList.remove('source-link-inserted-flash'), 1800);
  });
}

export function sourceLinkDescription(link: SourceLink) {
  const firstSource = link.sources[0];
  const parts = [
    link.display_text || null,
    firstSource?.page ? `p.${firstSource.page}` : null,
    firstSource?.segment_type ?? null
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(' · ') : '已添加到当前笔记';
}

export function compareSourceLinks(left: SourceLink, right: SourceLink) {
  const leftSource = left.sources[0];
  const rightSource = right.sources[0];
  return (
    (leftSource?.page ?? Number.MAX_SAFE_INTEGER) -
      (rightSource?.page ?? Number.MAX_SAFE_INTEGER) ||
    (left.display_text || left.anchor_id).localeCompare(right.display_text || right.anchor_id)
  );
}

export function findExistingSourceLinkForSameSource(links: SourceLink[], link: SourceLink) {
  const firstSource = link.sources[0];
  if (!firstSource) {
    return null;
  }

  return findSourceLinkForSegment(links, firstSource.entry_id, firstSource.segment_uid);
}
