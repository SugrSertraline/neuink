import { Extension, findParentNodeClosestToPos } from '@tiptap/core';
import { ResolvedPos } from '@tiptap/pm/model';
import { EditorState, NodeSelection, TextSelection } from '@tiptap/pm/state';
import { CellSelection } from '@tiptap/pm/tables';
import { EditorView } from '@tiptap/pm/view';
import { GapCursor } from 'prosemirror-gapcursor';

const DELETABLE_BLOCK_TYPES = new Set(['calloutBlock', 'dataTable', 'table']);

export const TableDeletionShortcuts = Extension.create({
  name: 'tableDeletionShortcuts',

  addKeyboardShortcuts() {
    const deleteAroundSelection = (direction: 'backward' | 'forward') => {
      const { state, view } = this.editor;
      const { selection } = state;
      const { empty, $from } = selection;

      if (selection instanceof NodeSelection && isDeletableBlock(selection.node.type.name)) {
        deleteRange(state, view, selection.from, selection.to);
        return true;
      }

      if (selection instanceof CellSelection) {
        const tableRange = findFullySelectedTableRange(selection);
        if (!tableRange) {
          return false;
        }
        deleteRange(state, view, tableRange.from, tableRange.to);
        return true;
      }

      if (!empty) {
        return false;
      }

      const currentBlockRange =
        $from.parent.isTextblock && $from.parentOffset === 0 && $from.parent.content.size === 0
          ? findEmptyCalloutAncestorRange($from)
          : null;
      const adjacentBlockRange =
        selection instanceof GapCursor
          ? direction === 'backward'
            ? findPreviousSiblingRange($from)
            : findNextSiblingRange($from)
          : direction === 'backward' && $from.parent.isTextblock && $from.parentOffset === 0
            ? findPreviousSiblingRange($from)
            : direction === 'forward' &&
                $from.parent.isTextblock &&
                $from.parentOffset === $from.parent.content.size
              ? findNextSiblingRange($from)
              : null;
      const targetRange = currentBlockRange ?? adjacentBlockRange;

      if (!targetRange || !isDeletableBlock(targetRange.node.type.name)) {
        return false;
      }

      deleteRange(state, view, targetRange.from, targetRange.to);
      return true;
    };

    return {
      Backspace: () => deleteAroundSelection('backward'),
      Delete: () => deleteAroundSelection('forward')
    };
  }
});

function isDeletableBlock(typeName: string) {
  return DELETABLE_BLOCK_TYPES.has(typeName);
}

function deleteRange(state: EditorState, view: EditorView, from: number, to: number) {
  const tr = state.tr.delete(from, to);
  const nextPos = Math.max(0, Math.min(from, tr.doc.content.size));

  tr.setSelection(TextSelection.create(tr.doc, nextPos));
  view.dispatch(tr);
}

function findEmptyCalloutAncestorRange($pos: ResolvedPos) {
  for (let depth = $pos.depth - 1; depth > 0; depth -= 1) {
    const node = $pos.node(depth);

    if (node.type.name !== 'calloutBlock') {
      continue;
    }

    const childIndex = $pos.index(depth);

    if (childIndex === 0 && node.childCount === 1) {
      return {
        from: $pos.before(depth),
        node,
        to: $pos.after(depth)
      };
    }
  }

  return null;
}

function findPreviousSiblingRange($pos: ResolvedPos) {
  for (let depth = $pos.depth; depth >= 0; depth -= 1) {
    const indexBefore = $pos.index(depth) - 1;
    if (indexBefore < 0) {
      continue;
    }

    const parent = $pos.node(depth);
    const previousSibling = parent.child(indexBefore);
    const boundaryPos = depth === 0 ? $pos.pos : $pos.before(depth + 1);

    return {
      from: boundaryPos - previousSibling.nodeSize,
      node: previousSibling,
      to: boundaryPos
    };
  }

  return null;
}

function findNextSiblingRange($pos: ResolvedPos) {
  for (let depth = $pos.depth; depth >= 0; depth -= 1) {
    const indexAfter = $pos.indexAfter(depth);
    const parent = $pos.node(depth);
    if (indexAfter >= parent.childCount) {
      continue;
    }

    const nextSibling = parent.child(indexAfter);
    const boundaryPos = depth === 0 ? $pos.pos : $pos.after(depth + 1);

    return {
      from: boundaryPos,
      node: nextSibling,
      to: boundaryPos + nextSibling.nodeSize
    };
  }

  return null;
}

function findFullySelectedTableRange(selection: CellSelection) {
  const table = findParentNodeClosestToPos(selection.ranges[0].$from, (node) => node.type.name === 'table');
  if (!table) {
    return null;
  }

  let cellCount = 0;
  table.node.descendants((node) => {
    if (node.type.name === 'table') {
      return false;
    }
    if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
      cellCount += 1;
    }
    return undefined;
  });

  if (cellCount !== selection.ranges.length) {
    return null;
  }

  return {
    from: table.pos,
    node: table.node,
    to: table.pos + table.node.nodeSize
  };
}
