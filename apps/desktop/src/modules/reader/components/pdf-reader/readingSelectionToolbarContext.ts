import { createContext } from 'react';
import type { PdfTextSelectionToolbarProps } from './PdfTextSelectionToolbar';

export const ReadingSelectionToolbarContext = createContext<{
  publish: (owner: string, props: PdfTextSelectionToolbarProps) => void;
  release: (owner: string) => void;
} | null>(null);
