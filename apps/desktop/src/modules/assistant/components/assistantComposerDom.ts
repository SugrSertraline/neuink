import {
  COMPOSER_CONTEXT_CHAR,
  normalizeComposerBlocks,
  type ComposerBlock
} from './assistantComposerBlocks';

export function readComposerBlocks(root: HTMLElement) {
  return normalizeComposerBlocks(readComposerNodeBlocks(root));
}

export function readComposerNodeBlocks(node: Node): ComposerBlock[] {
  if (node.nodeType === Node.TEXT_NODE) {
    return [{ text: node.textContent ?? '', type: 'text' }];
  }
  if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) {
    return [];
  }

  if (node.nodeType === Node.ELEMENT_NODE) {
    const element = node as HTMLElement;
    const contextId = element.dataset.contextId;
    if (contextId) {
      return [{ itemId: contextId, type: 'context' }];
    }
    if (element.tagName === 'BR') {
      return [{ text: '\n', type: 'text' }];
    }
  }

  return Array.from(node.childNodes).flatMap((child) => readComposerNodeBlocks(child));
}

export function readComposerPlainText(root: HTMLElement) {
  return readComposerNodeText(root).replace(/\u00a0/g, ' ');
}

export function readComposerNodeText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? '';
  }
  if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) {
    return '';
  }

  if (node.nodeType === Node.ELEMENT_NODE) {
    const element = node as HTMLElement;
    if (element.dataset.contextId) {
      return COMPOSER_CONTEXT_CHAR;
    }
    if (element.tagName === 'BR') {
      return '\n';
    }
  }

  return Array.from(node.childNodes)
    .map((child) => readComposerNodeText(child))
    .join('');
}

export function getComposerCaretOffset(root: HTMLElement | null) {
  if (!root) {
    return 0;
  }
  if (root instanceof HTMLTextAreaElement) {
    return root.selectionStart ?? root.value.length;
  }
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return readComposerPlainText(root).length;
  }

  const range = selection.getRangeAt(0);
  if (!root.contains(range.endContainer)) {
    return readComposerPlainText(root).length;
  }

  const beforeCaret = range.cloneRange();
  beforeCaret.selectNodeContents(root);
  beforeCaret.setEnd(range.endContainer, range.endOffset);
  return readComposerNodeText(beforeCaret.cloneContents()).length;
}

export function getComposerSelectionOffsets(root: HTMLElement) {
  if (root instanceof HTMLTextAreaElement) {
    return {
      end: root.selectionEnd ?? root.value.length,
      start: root.selectionStart ?? root.value.length
    };
  }
  const selection = window.getSelection();
  const anchorNode = selection?.anchorNode ?? null;
  const focusNode = selection?.focusNode ?? null;
  if (!selection || selection.rangeCount === 0 || !anchorNode || !focusNode || !root.contains(anchorNode) || !root.contains(focusNode)) {
    const offset = readComposerPlainText(root).length;
    return { end: offset, start: offset };
  }

  const anchor = getComposerEndpointOffset(root, anchorNode, selection.anchorOffset);
  const focus = getComposerEndpointOffset(root, focusNode, selection.focusOffset);
  return {
    end: Math.max(anchor, focus),
    start: Math.min(anchor, focus)
  };
}

export function getComposerEndpointOffset(root: HTMLElement, node: Node, offset: number) {
  const range = document.createRange();
  range.selectNodeContents(root);
  range.setEnd(node, offset);
  return readComposerNodeText(range.cloneContents()).length;
}

export function setComposerCaretOffset(root: HTMLElement, offset: number) {
  if (root instanceof HTMLTextAreaElement) {
    root.setSelectionRange(offset, offset);
    return;
  }
  const range = document.createRange();
  const position = findComposerCaretPosition(root, Math.max(0, offset));
  if (position.kind === 'after') {
    range.setStartAfter(position.node);
  } else if (position.kind === 'before') {
    range.setStartBefore(position.node);
  } else if (position.kind === 'container') {
    range.setStart(position.node, position.offset);
  } else {
    range.setStart(position.node, position.offset);
  }
  range.collapse(true);

  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

export function findComposerCaretPosition(
  root: Node,
  offset: number
):
  | { kind: 'after'; node: Node }
  | { kind: 'before'; node: Node }
  | { kind: 'container'; node: Node; offset: number }
  | { kind: 'text'; node: Text; offset: number } {
  let remaining = offset;

  const visit = (
    node: Node
  ):
    | { kind: 'after'; node: Node }
    | { kind: 'before'; node: Node }
    | { kind: 'container'; node: Node; offset: number }
    | { kind: 'text'; node: Text; offset: number }
    | null => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? '';
      if (remaining <= text.length) {
        return {
          kind: 'text',
          node: node as Text,
          offset: remaining
        };
      }
      remaining -= text.length;
      return null;
    }

    if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as HTMLElement;
      if (element.dataset.contextId) {
        if (remaining <= 0) {
          return { kind: 'before', node };
        }
        if (remaining <= 1) {
          return { kind: 'after', node };
        }
        remaining -= 1;
        return null;
      }
      if (element.tagName === 'BR') {
        if (remaining <= 1) {
          return { kind: 'after', node };
        }
        remaining -= 1;
        return null;
      }
    }

    for (const child of Array.from(node.childNodes)) {
      const found = visit(child);
      if (found) {
        return found;
      }
    }
    return null;
  };

  return visit(root) ?? { kind: 'container', node: root, offset: root.childNodes.length };
}

