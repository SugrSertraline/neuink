// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { applyRemoteMarkdown } from './applyRemoteMarkdown';
it('maps selection and undo through a remote segment draft instead of resetting the whole editor', () => {
  const editor = new Editor({ extensions: [StarterKit, Markdown], content: 'Base', contentType: 'markdown' });
  editor.commands.insertContentAt(5, ' A');
  editor.commands.setTextSelection(3);
  applyRemoteMarkdown(editor, 'Base A B');
  expect(editor.state.selection.from).toBe(3);
  expect(editor.getText()).toBe('Base A B');
  editor.commands.undo(); expect(editor.getText()).toBe('Base B');
  editor.destroy();
});
