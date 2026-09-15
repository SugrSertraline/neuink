import { invoke } from '@tauri-apps/api/core';

export type PaperExportKind = 'source' | 'translation' | 'bilingual';
export type PaperExportFormat = 'docx' | 'txt' | 'markdown_zip';
export type DiagramExportMode = 'original' | 'rendered' | 'mermaid' | 'original_with_source';
export type PaperExportOptions = { diagrams: DiagramExportMode; image_width: 'compact' | 'standard' | 'full'; include_source_refs: boolean };
export type ExportDiagram = { id: string; segment_uid: string; page: number; code: string };
export type RenderedExportDiagram = { id: string; png_base64: string };
export type PaperExportInspection = {
  fingerprint: string;
  total: number;
  translated: number;
  preserved: number;
  missing: number;
  stale: number;
  unverified_images: number;
  missing_assets: number;
  // Actual missing/stale content only; unverified image text is informational.
  requires_draft: boolean;
  issues: Array<{ segment_uid: string; page: number; message: string }>;
  diagrams: ExportDiagram[];
};

export type PaperExportPreview = {
  fingerprint: string;
  segment_uid: string;
  page: number;
  markdown: string;
  assets: Record<string, string>;
  diagrams: ExportDiagram[];
};

export function previewPaperExport(request: {
  root: string;
  entry_id: string;
  kind: PaperExportKind;
  options: PaperExportOptions;
  expected_fingerprint: string;
  segment_uid: string;
}) {
  return invoke<PaperExportPreview>('preview_paper_export', { request });
}

export function inspectPaperExport(root: string, entryId: string, kind: PaperExportKind, options: PaperExportOptions) {
  return invoke<PaperExportInspection>('inspect_paper_export', {
    request: { root, entry_id: entryId, kind, options }
  });
}

export function exportPaper(request: {
  root: string;
  entry_id: string;
  kind: PaperExportKind;
  format: PaperExportFormat;
  target_path: string;
  expected_fingerprint: string;
  allow_draft: boolean;
  options: PaperExportOptions;
  rendered_diagrams: RenderedExportDiagram[];
}) {
  return invoke<PaperExportInspection>('export_paper', { request });
}
