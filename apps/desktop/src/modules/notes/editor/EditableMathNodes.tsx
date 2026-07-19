import { BlockMath, InlineMath } from '@tiptap/extension-mathematics';
import { Fragment } from '@tiptap/pm/model';
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import katex from 'katex';
import { useEffect, useRef, useState } from 'react';

type MathKind = 'block' | 'inline';

export const EditableBlockMath = BlockMath.extend({
  addNodeView() {
    return ReactNodeViewRenderer(EditableBlockMathView);
  }
});

export const EditableInlineMath = InlineMath.extend({
  addNodeView() {
    return ReactNodeViewRenderer(EditableInlineMathView);
  }
});

export function parseMathSource(value: string, fallbackKind: MathKind) {
  const source = value.trim();
  if (source.startsWith('$$') && source.endsWith('$$') && source.length >= 4) {
    return { kind: 'block' as const, latex: source.slice(2, -2).trim() };
  }
  if (source.startsWith('$') && source.endsWith('$') && source.length >= 2) {
    return { kind: 'inline' as const, latex: source.slice(1, -1).trim() };
  }
  return { kind: fallbackKind, latex: source };
}

function EditableBlockMathView(props: NodeViewProps) {
  return <EditableMathView {...props} kind="block" />;
}

function EditableInlineMathView(props: NodeViewProps) {
  return <EditableMathView {...props} kind="inline" />;
}

function EditableMathView({ editor, getPos, node, updateAttributes, kind }: NodeViewProps & { kind: MathKind }) {
  const latex = String(node.attrs.latex ?? '');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => mathSource(kind, latex));
  const inputRef = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);
  const skipBlurCommitRef = useRef(false);
  const html = katex.renderToString(latex, {
    displayMode: kind === 'block',
    strict: false,
    throwOnError: false
  });

  useEffect(() => {
    if (!editing) setDraft(mathSource(kind, latex));
  }, [editing, kind, latex]);

  useEffect(() => {
    if (!editing) return;
    skipBlurCommitRef.current = false;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  const commit = () => {
    const next = parseMathSource(draft, kind);
    const pos = typeof getPos === 'function' ? getPos() : undefined;
    if (pos === undefined) {
      setEditing(false);
      return;
    }

    if (next.kind === kind) {
      if (next.latex !== latex) updateAttributes({ latex: next.latex });
    } else if (next.kind === 'inline') {
      const inlineMath = editor.schema.nodes.inlineMath;
      const paragraph = editor.schema.nodes.paragraph;
      if (inlineMath && paragraph) {
        editor.view.dispatch(
          editor.state.tr.replaceWith(
            pos,
            pos + node.nodeSize,
            paragraph.create(null, inlineMath.create({ latex: next.latex }))
          )
        );
      }
    } else {
      replaceInlineMathWithBlock(editor, pos, node.nodeSize, next.latex);
    }
    setEditing(false);
    editor.commands.focus();
  };

  const cancel = () => {
    skipBlurCommitRef.current = true;
    setDraft(mathSource(kind, latex));
    setEditing(false);
  };

  const editorControl = kind === 'block' ? (
    <textarea
      ref={inputRef as React.RefObject<HTMLTextAreaElement>}
      aria-label="编辑行间公式 Markdown 源码"
      className="block-math-editor"
      rows={Math.max(3, draft.split('\n').length)}
      value={draft}
      onBlur={() => {
        if (!skipBlurCommitRef.current) commit();
        skipBlurCommitRef.current = false;
      }}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          commit();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          cancel();
        }
      }}
    />
  ) : (
    <input
      ref={inputRef as React.RefObject<HTMLInputElement>}
      aria-label="编辑行内公式 Markdown 源码"
      className="inline-math-editor"
      value={draft}
      onBlur={() => {
        if (!skipBlurCommitRef.current) commit();
        skipBlurCommitRef.current = false;
      }}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          cancel();
        }
      }}
    />
  );

  return (
    <NodeViewWrapper
      as={kind === 'block' ? 'div' : 'span'}
      className={kind === 'block' ? 'block-math-node' : 'inline-math-node'}
      contentEditable={false}
      data-type={`${kind}-math`}
      data-latex={latex}
    >
      {editing ? (
        <div className="math-source-editor">
          <div className="math-source-editor-label">
            {kind === 'block' ? '行间公式 Markdown 源码：改为 $...$ 可降级为行内公式' : '行内公式 Markdown 源码：改为 $$...$$ 可升级为行间公式'}
          </div>
          {editorControl}
        </div>
      ) : (
        <span
          role="button"
          tabIndex={0}
          className={kind === 'block' ? 'block-math-render' : 'inline-math-render'}
          title="点击直接编辑 Markdown 公式源码"
          dangerouslySetInnerHTML={{ __html: html }}
          onClick={() => setEditing(true)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              setEditing(true);
            }
          }}
        />
      )}
    </NodeViewWrapper>
  );
}

function mathSource(kind: MathKind, latex: string) {
  return kind === 'block' ? `$$\n${latex}\n$$` : `$${latex}$`;
}

function replaceInlineMathWithBlock(
  editor: NodeViewProps['editor'],
  pos: number,
  nodeSize: number,
  latex: string
) {
  const blockMath = editor.schema.nodes.blockMath;
  const paragraph = editor.schema.nodes.paragraph;
  if (!blockMath || !paragraph) return;

  const $node = editor.state.doc.resolve(pos);
  const parent = $node.parent;
  if (!parent.isTextblock) return;

  const before = parent.content.cut(0, $node.parentOffset);
  const after = parent.content.cut($node.parentOffset + nodeSize);
  const replacement = [
    ...(before.size ? [paragraph.create(null, before)] : []),
    blockMath.create({ latex }),
    ...(after.size ? [paragraph.create(null, after)] : [])
  ];
  editor.view.dispatch(
    editor.state.tr.replaceWith($node.before($node.depth), $node.after($node.depth), Fragment.from(replacement))
  );
}
