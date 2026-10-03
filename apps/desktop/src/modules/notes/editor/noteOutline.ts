import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

export type NoteOutlineItem = {
  /** Position before the node, usable directly with EditorView.nodeDOM. */
  position: number;
  kind: string;
  label: string;
  depth: number;
  headingLevel?: number;
};

const PREVIEW_LENGTH = 64;
const LISTS = new Set(['bulletList', 'orderedList', 'taskList']);
const PARAGRAPH_CONTAINERS = new Set(['listItem', 'taskItem', 'tableCell', 'tableHeader']);

/** Derive navigation from the current document without IDs, transactions or persisted state. */
export function collectNoteOutline(doc: ProseMirrorNode): NoteOutlineItem[] {
  const items: NoteOutlineItem[] = [];

  const visit = (parent: ProseMirrorNode, contentStart: number, baseDepth: number, suppressParagraphs: boolean) => {
    // Nested containers have their own section scope; their headings never reparent later siblings.
    const headings: number[] = [];
    parent.forEach((node, offset) => {
      const position = contentStart + offset;
      const kind = node.type.name;
      if (kind === 'heading') {
        const headingLevel = Math.min(6, Math.max(1, Number(node.attrs.level) || 1));
        while (headings.length && headings[headings.length - 1] >= headingLevel) headings.pop();
        const depth = baseDepth + headings.length;
        items.push({ position, kind, label: normalizedText(node, node.content.size) || '未命名标题', depth, headingLevel });
        headings.push(headingLevel);
        visit(node, position + 1, depth + 1, false);
        return;
      }

      const depth = baseDepth + headings.length;
      const label = kind === 'paragraph' && suppressParagraphs ? null : nodeLabel(node);
      if (label !== null) items.push({ position, kind, label, depth });
      if (!node.isLeaf) {
        visit(node, position + 1, depth + (label === null ? 0 : 1),
          suppressParagraphs || PARAGRAPH_CONTAINERS.has(kind));
      }
    });
  };

  // Unlike a normal node, the document has no opening token before its content.
  visit(doc, 0, 0, false);
  return items;
}

function nodeLabel(node: ProseMirrorNode): string | null {
  const kind = node.type.name;
  if (LISTS.has(kind)) {
    const text = node.firstChild ? preview(node.firstChild) : '';
    let count = `${node.childCount} 项`;
    if (kind === 'taskList') {
      let completed = 0;
      node.forEach(child => { if (child.attrs.checked === true) completed += 1; });
      count = `${completed}/${node.childCount} 已完成`;
    }
    return compact([count, text].filter(Boolean).join(' · '));
  }
  switch (kind) {
    case 'paragraph':
      // Empty editing placeholders and atom-only paragraphs add no extra navigation value.
      return node.textContent.trim() ? preview(node) : null;
    case 'image':
      return compact(string(node.attrs.alt) || string(node.attrs.title) || imageName(node.attrs.src)) || '图片';
    case 'table': {
      const columns = node.firstChild?.childCount ?? 0;
      return compact([`${node.childCount} 行 × ${columns} 列`, node.firstChild ? preview(node.firstChild) : ''].filter(Boolean).join(' · '));
    }
    case 'dataTable': {
      const data = node.attrs.data as { title?: unknown; rows?: unknown; columns?: unknown } | null;
      if (string(data?.title)) return compact(string(data?.title));
      const columns = Array.isArray(data?.columns) ? data.columns : [];
      const rows = Array.isArray(data?.rows) ? data.rows : [];
      const names = columns.map(column => string(column?.name)).filter(Boolean).join(' · ');
      return compact([`${rows.length} 行 × ${columns.length} 列`, names].filter(Boolean).join(' · '));
    }
    case 'blockMath':
      return compact(string(node.attrs.latex)) || '块公式';
    case 'inlineMath':
      return compact(string(node.attrs.latex)) || '行内公式';
    case 'codeBlock':
      return compact([string(node.attrs.language), preview(node)].filter(Boolean).join(' · ')) || '代码块';
    case 'mermaidDiagram':
      return compact(string(node.attrs.code)) || 'Mermaid 图';
    case 'blockquote':
      return preview(node) || '引用';
    case 'calloutBlock':
      return compact(string(node.attrs.title)) || preview(node) || '提示块';
    case 'sourceLink':
      return compact(string(node.attrs.displayText) || string(node.attrs.snapshotText)) ||
        (typeof node.attrs.page === 'number' && Number.isFinite(node.attrs.page) ? `第 ${node.attrs.page} 页` : '来源链接');
    case 'horizontalRule':
      return '分隔线';
    default:
      return null;
  }
}

function preview(node: ProseMirrorNode) {
  // A bounded read prevents long lists/tables from copying all their text for one small label.
  return compact(normalizedText(node, Math.min(node.content.size, 256)));
}

function normalizedText(node: ProseMirrorNode, end: number) {
  return node.textBetween(0, end, ' ', leaf => {
    if (leaf.type.name === 'hardBreak') return ' ';
    return string(leaf.attrs.displayText) || string(leaf.attrs.snapshotText) || string(leaf.attrs.latex) || string(leaf.attrs.alt);
  }).replace(/\s+/g, ' ').trim();
}

function string(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function compact(value: string): string {
  const characters = Array.from(value.replace(/\s+/g, ' ').trim());
  return characters.length > PREVIEW_LENGTH ? `${characters.slice(0, PREVIEW_LENGTH - 1).join('')}…` : characters.join('');
}

function imageName(value: unknown): string {
  const source = string(value);
  if (!source || source.startsWith('data:')) return '';
  const name = source.split(/[?#]/, 1)[0].replace(/\\/g, '/').split('/').pop() ?? '';
  try { return decodeURIComponent(name); } catch { return name; }
}
