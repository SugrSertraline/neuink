import { TextStyle } from '@tiptap/extension-text-style';

type MarkdownRenderHelpers = {
  renderChildren: (node: unknown) => string;
};

type MarkdownNode = {
  attrs?: {
    color?: string | null;
  };
};

export const MarkdownTextStyle = TextStyle.extend({
  renderMarkdown(node: MarkdownNode, helpers: MarkdownRenderHelpers) {
    const content = helpers.renderChildren(node);
    const color = sanitizeCssColor(node.attrs?.color);

    if (!color) {
      return content;
    }

    return `<span style="color: ${color}">${content}</span>`;
  }
} as Record<string, unknown>);

function sanitizeCssColor(color?: string | null) {
  if (!color) {
    return null;
  }
  const value = color.trim();
  if (/^#[0-9a-fA-F]{3,8}$/.test(value)) {
    return value;
  }
  if (/^(rgb|rgba|hsl|hsla)\([0-9%.,\s-]+\)$/.test(value)) {
    return value;
  }
  return null;
}
