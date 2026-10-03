// @vitest-environment jsdom
import { Editor, type JSONContent } from '@tiptap/core';
import { Table } from '@tiptap/extension-table';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TableRow from '@tiptap/extension-table-row';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import { Markdown } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CalloutBlock } from './CalloutBlock';
import { DataTableNode } from './DataTableNode';
import { EditableBlockMath, EditableInlineMath } from './EditableMathNodes';
import { MermaidDiagram } from './MermaidDiagram';
import { NoteImage } from './NoteImage';
import { SourceLinkNode } from './SourceLinkNode';
import { collectNoteOutline } from './noteOutline';

const editors: Editor[] = [];
afterEach(() => { editors.splice(0).forEach(editor => editor.destroy()); });
const text = (value: string): JSONContent => ({ type: 'text', text: value });
const paragraph = (value = ''): JSONContent => ({ type: 'paragraph', content: value ? [text(value)] : [] });
const heading = (level: number, value = ''): JSONContent => ({ type: 'heading', attrs: { level }, content: value ? [text(value)] : [] });
const image = (alt: string): JSONContent => ({ type: 'image', attrs: { src: 'assets/figure.png', alt } });

function createEditor(content: JSONContent[] | string = []) {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [StarterKit, Table, TableRow, TableHeader, TableCell, TaskList, TaskItem.configure({ nested: true }),
      EditableBlockMath, EditableInlineMath, NoteImage, DataTableNode, CalloutBlock, MermaidDiagram, SourceLinkNode, Markdown],
    content: typeof content === 'string' ? content : { type: 'doc', content },
    ...(typeof content === 'string' ? { contentType: 'markdown' as const } : {})
  });
  editors.push(editor);
  return editor;
}

function expectLocatable(editor: Editor) {
  const outline = collectNoteOutline(editor.state.doc);
  expect(new Set(outline.map(item => item.position)).size).toBe(outline.length);
  for (const item of outline) {
    expect(editor.state.doc.nodeAt(item.position)?.type.name).toBe(item.kind);
    expect(editor.view.nodeDOM(item.position), `${item.kind}: ${item.label}`).not.toBeNull();
  }
}

describe('collectNoteOutline', () => {
  it('uses the existing heading ancestry rather than indenting by skipped level numbers', () => {
    const editor = createEditor([heading(1, '一'), paragraph('正文'), heading(4, '四'), heading(6, '六'),
      heading(2, '二'), heading(3, '三'), heading(5, '五'), heading(1, '重启')]);
    expect(collectNoteOutline(editor.state.doc).map(({ label, depth, headingLevel }) => [label, depth, headingLevel])).toEqual([
      ['一', 0, 1], ['正文', 1, undefined], ['四', 1, 4], ['六', 2, 6], ['二', 1, 2], ['三', 2, 3], ['五', 3, 5], ['重启', 0, 1]
    ]);
    expectLocatable(editor);
  });

  it('retains repeated and empty headings as separate positions without modifying the document', () => {
    const editor = createEditor([heading(3, '重复'), heading(3, '重复'), heading(6), paragraph()]);
    const before = editor.getJSON();
    const doc = editor.state.doc;
    const transaction = vi.fn();
    editor.on('transaction', transaction);
    const outline = collectNoteOutline(doc);
    expect(outline.map(item => [item.label, item.depth])).toEqual([['重复', 0], ['重复', 0], ['未命名标题', 1]]);
    expect(outline[0].position).not.toBe(outline[1].position);
    expect(editor.state.doc).toBe(doc);
    expect(editor.getJSON()).toEqual(before);
    expect(transaction).not.toHaveBeenCalled();
    expectLocatable(editor);
  });

  it('recomputes labels and exact nested positions after real insertions, edits and deletion', () => {
    const editor = createEditor([heading(1, '标题'), { type: 'blockquote', content: [heading(3, '内部'), paragraph('引用正文')] }]);
    const original = collectNoteOutline(editor.state.doc).find(item => item.label === '内部')!;
    editor.commands.insertContentAt(0, paragraph('新段落'));
    let target = collectNoteOutline(editor.state.doc).find(item => item.label === '内部')!;
    expect(target.position).toBe(original.position + editor.state.doc.firstChild!.nodeSize);
    editor.view.dispatch(editor.state.tr.insertText('更新', target.position + 1));
    target = collectNoteOutline(editor.state.doc).find(item => item.kind === 'heading' && item.label === '更新内部')!;
    expectLocatable(editor);
    editor.commands.deleteRange({ from: target.position, to: target.position + editor.state.doc.nodeAt(target.position)!.nodeSize });
    expect(collectNoteOutline(editor.state.doc).some(item => item.label.includes('内部'))).toBe(false);
    expectLocatable(editor);
  });

  it('groups list and table content without losing nested headings or special nodes', () => {
    const editor = createEditor([heading(1, '章'), { type: 'bulletList', content: [{ type: 'listItem', content: [
      paragraph('列表正文'), heading(4, '列表标题'), image('列表图片'),
      { type: 'orderedList', content: [{ type: 'listItem', content: [paragraph('次级列表')] }] }
    ] }] }, { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [
      paragraph('表格正文'), heading(5, '表内标题'), { type: 'paragraph', content: [{ type: 'inlineMath', attrs: { latex: 'x^2' } }] }, image('表格图片')
    ] }] }] }, paragraph('章末')]);
    const outline = collectNoteOutline(editor.state.doc);
    expect(outline.map(item => item.kind)).toEqual(['heading', 'bulletList', 'heading', 'image', 'orderedList', 'table', 'heading', 'inlineMath', 'image', 'paragraph']);
    expect(outline.map(item => item.depth)).toEqual([0, 1, 2, 3, 3, 1, 2, 3, 3, 1]);
    expect(outline.find(item => item.kind === 'bulletList')?.label).toContain('列表正文');
    expect(outline.find(item => item.kind === 'table')?.label).toContain('1 行 × 1 列');
    expectLocatable(editor);
  });

  it('reads attributes of all supported atoms and containers from the real extension schema', () => {
    const editor = createEditor([
      { type: 'taskList', content: [
        { type: 'taskItem', attrs: { checked: true }, content: [paragraph('完成')] },
        { type: 'taskItem', attrs: { checked: false }, content: [paragraph('待办')] }
      ] }, image('实验结果'),
      { type: 'dataTable', attrs: { data: { version: 2, title: '实验数据', columns: [], rows: [] } } },
      { type: 'blockMath', attrs: { latex: 'E = mc^2' } },
      { type: 'paragraph', content: [text('行内 '), { type: 'inlineMath', attrs: { latex: 'a+b' } },
        { type: 'sourceLink', attrs: { anchorId: 'sl-outline', displayText: '关键证据', snapshotText: '证据正文' } }] },
      { type: 'codeBlock', attrs: { language: 'typescript' }, content: [text('const answer = 42;')] },
      { type: 'mermaidDiagram', attrs: { code: 'graph TD\nA --> B' } },
      { type: 'blockquote', content: [paragraph('引用内容')] },
      { type: 'calloutBlock', attrs: { title: '注意事项', variant: 'warning' }, content: [paragraph('请核对结果')] },
      { type: 'horizontalRule' }
    ]);
    const outline = collectNoteOutline(editor.state.doc);
    for (const [kind, label] of [
      ['taskList', '1/2 已完成 · 完成'], ['image', '实验结果'], ['dataTable', '实验数据'], ['blockMath', 'E = mc^2'],
      ['inlineMath', 'a+b'], ['sourceLink', '关键证据'], ['codeBlock', 'typescript · const answer = 42;'],
      ['mermaidDiagram', 'graph TD A --> B'], ['blockquote', '引用内容'], ['calloutBlock', '注意事项'], ['horizontalRule', '分隔线']
    ]) expect(outline).toContainEqual(expect.objectContaining({ kind, label }));
    expectLocatable(editor);
  });

  it('keeps empty documents empty and supports documents without headings', () => {
    const editor = createEditor([paragraph(), paragraph('   ')]);
    expect(collectNoteOutline(editor.state.doc)).toEqual([]);
    editor.commands.setContent({ type: 'doc', content: [paragraph('普通正文'), image('图示')] });
    expect(collectNoteOutline(editor.state.doc).map(item => [item.kind, item.depth])).toEqual([['paragraph', 0], ['image', 0]]);
    expectLocatable(editor);
  });

  it('uses descriptive fallbacks for empty atoms and bounded, whitespace-normalized previews', () => {
    const editor = createEditor([paragraph('长段落😀'.repeat(40)),
      { type: 'image', attrs: { src: 'assets/%E5%9B%BE%E7%89%87.png?private=value' } },
      { type: 'image', attrs: { src: 'data:image/png;base64,ignored' } },
      { type: 'dataTable', attrs: { data: { version: 2, columns: [{ name: '指标' }], rows: [{}] } } },
      { type: 'blockMath' }, { type: 'codeBlock' }, { type: 'mermaidDiagram' },
      { type: 'paragraph', content: [{ type: 'inlineMath' }, { type: 'sourceLink', attrs: { page: 4 } }, { type: 'sourceLink' }] },
      { type: 'calloutBlock', content: [paragraph()] }, { type: 'blockquote', content: [paragraph()] }
    ]);
    const labels = collectNoteOutline(editor.state.doc).map(item => item.label);
    expect(Array.from(labels[0])).toHaveLength(64);
    expect(labels[0].endsWith('…')).toBe(true);
    expect(labels).toEqual(expect.arrayContaining(['图片.png', '图片', '1 行 × 1 列 · 指标', '块公式', '行内公式', '代码块', 'Mermaid 图', '第 4 页', '来源链接', '提示块', '引用']));
    expectLocatable(editor);
  });

  it('preserves the complete normalized heading including inline atoms for search and full labels', () => {
    const beginning = '长标题😀'.repeat(80);
    const editor = createEditor([{ type: 'heading', attrs: { level: 2 }, content: [
      text(`  ${beginning}   `), { type: 'inlineMath', attrs: { latex: 'x^2 + y^2' } },
      { type: 'hardBreak' }, { type: 'sourceLink', attrs: { anchorId: 'sl-long', displayText: '完整来源标题' } },
      text('   可检索的末尾')
    ] }]);
    const item = collectNoteOutline(editor.state.doc)[0];
    expect(item.label).toBe(`${beginning} x^2 + y^2 完整来源标题 可检索的末尾`);
    expect(item.label.length).toBeGreaterThan(256);
    expect(item.label.endsWith('可检索的末尾')).toBe(true);
    expectLocatable(editor);
  });

  it('uses parsed Markdown structure rather than scanning marker-looking content', () => {
    const editor = createEditor('# 章节\n\n普通 **正文**\n\n```text\n# 不是标题\n```\n\n```mermaid\ngraph LR\nA --> B\n```\n\n> 引用');
    const outline = collectNoteOutline(editor.state.doc);
    expect(outline.filter(item => item.kind === 'heading').map(item => item.label)).toEqual(['章节']);
    expect(outline.find(item => item.kind === 'paragraph')?.label).toBe('普通 正文');
    expect(outline.find(item => item.kind === 'codeBlock')?.label).toBe('text · # 不是标题');
    expect(outline.find(item => item.kind === 'mermaidDiagram')?.label).toContain('graph LR');
    expectLocatable(editor);
  });
});
