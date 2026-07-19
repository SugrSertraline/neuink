import { Extension } from '@tiptap/core';
import type { Node as ProseMirrorNode, NodeType } from '@tiptap/pm/model';
import { Plugin } from '@tiptap/pm/state';
import type { Transaction } from '@tiptap/pm/state';

// Tiptap's official Mathematics extension owns the math nodes and rendering.
// This adapter removes Markdown delimiters left behind by visual-editor input.
export const MathMarkdownInputRules = Extension.create({
  name: 'mathMarkdownInputRules',

  addProseMirrorPlugins() {
    const blockMath = this.editor.schema.nodes.blockMath;
    if (!blockMath) return [];

    return [
      new Plugin({
        appendTransaction: (_transactions, _oldState, newState) =>
          normalizeBlockMathDelimiters(newState.doc, newState.tr, blockMath)
      })
    ];
  }
});

function normalizeBlockMathDelimiters(
  doc: ProseMirrorNode,
  transaction: Transaction,
  blockMath: NodeType
) {
  const children: Array<{ node: ProseMirrorNode; pos: number }> = [];
  doc.forEach((node, pos) => children.push({ node, pos }));

  const replacements: Array<{ from: number; node: typeof children[number]['node']; to: number }> = [];
  for (let index = 0; index < children.length - 2; index += 1) {
    const opening = children[index];
    const formula = children[index + 1];
    const closing = children[index + 2];
    if (!isBlockDelimiter(opening.node) || !isBlockDelimiter(closing.node)) continue;

    if (formula.node.type === blockMath) {
      replacements.push({
        from: opening.pos,
        node: formula.node,
        to: closing.pos + closing.node.nodeSize
      });
      index += 2;
      continue;
    }

    const latex = formula.node.isTextblock ? formula.node.textContent.trim() : '';
    if (latex) {
      replacements.push({
        from: opening.pos,
        node: blockMath.create({ latex }),
        to: closing.pos + closing.node.nodeSize
      });
      index += 2;
    }
  }

  for (const replacement of replacements.reverse()) {
    transaction.replaceWith(replacement.from, replacement.to, replacement.node);
  }
  return transaction.docChanged ? transaction : null;
}

function isBlockDelimiter(node: { isTextblock: boolean; textContent: string }) {
  return node.isTextblock && node.textContent.trim() === '$$';
}
