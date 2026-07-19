/** @vitest-environment jsdom */

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SourceSnapshotPreview } from './SourceSnapshotPreview';

vi.mock('./MermaidDiagramPreview', () => ({
  MermaidDiagramPreview: ({ code }: { code: string }) => (
    <div data-code={code} data-testid="mermaid-preview" />
  ),
}));

describe('SourceSnapshotPreview', () => {
  it('renders Mermaid code fences as diagrams in parsed PDF previews', () => {
    render(
      <SourceSnapshotPreview
        markdown={'```mermaid\ngraph TD\n  A --> B\n```'}
        previewMode="parsed"
      />,
    );

    expect(screen.getByTestId('mermaid-preview').getAttribute('data-code')).toBe(
      'graph TD\n A --> B',
    );
  });
});
