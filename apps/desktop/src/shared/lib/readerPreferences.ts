import { normalizeReflowComponentContent, type ReflowComponentContent } from './reflowContentPreferences';

export type PdfHoverPreviewFontSize = 'small' | 'standard' | 'large';
export type PdfHoverPreviewSize = 'compact' | 'standard' | 'large';

export const REFLOW_FONT_SIZE_MIN = 13;
export const REFLOW_FONT_SIZE_MAX = 24;
export const REFLOW_FONT_SIZE_DEFAULT = 16;
export const REFLOW_BACKGROUND_COLOR_DEFAULT = '#ffffff';

export type ReflowComponentTextSize = 'small' | 'standard' | 'large';
export type ReflowVisualSize = 'compact' | 'standard' | 'large' | 'full';
export type ReflowTextComponentPreference = {
  visible: boolean;
  size: ReflowComponentTextSize;
};
export type ReflowVisualComponentPreference = {
  visible: boolean;
  size: ReflowVisualSize;
};
export type ReflowComponentPreferences = {
  content?: ReflowComponentContent;
  heading: ReflowTextComponentPreference;
  paragraph: ReflowTextComponentPreference;
  list: ReflowTextComponentPreference;
  table: ReflowTextComponentPreference;
  math: ReflowTextComponentPreference;
  code: ReflowTextComponentPreference;
  supportingText: ReflowTextComponentPreference;
  figure: ReflowVisualComponentPreference;
  chart: ReflowVisualComponentPreference;
  diagramVisible: boolean;
  imageClickToOpen: boolean;
};

export const DEFAULT_REFLOW_COMPONENT_PREFERENCES: ReflowComponentPreferences = {
  heading: { visible: true, size: 'standard' },
  paragraph: { visible: true, size: 'standard' },
  list: { visible: true, size: 'standard' },
  table: { visible: true, size: 'standard' },
  math: { visible: true, size: 'standard' },
  code: { visible: true, size: 'standard' },
  supportingText: { visible: true, size: 'standard' },
  figure: { visible: true, size: 'standard' },
  chart: { visible: true, size: 'large' },
  diagramVisible: true,
  imageClickToOpen: true
};

export type ReaderPreferences = {
  openEntryPdfByDefault: boolean;
  autoTranslateTextSelection: boolean;
  closeSegmentOverlayOnBlankClick: boolean;
  closeSegmentOverlayOnSameSegmentClick: boolean;
  hoverPreviewEnabled: boolean;
  pdfHoverPreviewFontSize: PdfHoverPreviewFontSize;
  pdfHoverPreviewSize: PdfHoverPreviewSize;
  hoverPreviewShowRegion: boolean;
  hoverPreviewShowOriginal: boolean;
  hoverPreviewShowNote: boolean;
  hoverPreviewShowAnnotation: boolean;
  hoverPreviewShowTranslation: boolean;
  leftClickOpensNotePane: boolean;
  segmentNoteOpenGesture: 'button' | 'single' | 'modifier';
  reflowBackgroundColor: string;
  reflowComponents: ReflowComponentPreferences;
  reflowFontSize: number;
  reflowTranslationMode: 'source' | 'translation' | 'bilingual';
  reflowHoverSourceEnabled: boolean;
  showRegions: boolean;
  pageDisplayMode: 'single' | 'dual';
  pageTurningMode?: 'scroll' | 'book';
};

const READER_PREFERENCES_STORAGE_KEY = 'neuink.reader.preferences';

const DEFAULT_READER_PREFERENCES: ReaderPreferences = {
  openEntryPdfByDefault: true,
  autoTranslateTextSelection: false,
  closeSegmentOverlayOnBlankClick: true,
  closeSegmentOverlayOnSameSegmentClick: true,
  hoverPreviewEnabled: true,
  pdfHoverPreviewFontSize: 'standard',
  pdfHoverPreviewSize: 'standard',
  hoverPreviewShowRegion: true,
  hoverPreviewShowOriginal: true,
  hoverPreviewShowNote: true,
  hoverPreviewShowAnnotation: true,
  hoverPreviewShowTranslation: true,
  leftClickOpensNotePane: false,
  segmentNoteOpenGesture: 'button',
  reflowBackgroundColor: REFLOW_BACKGROUND_COLOR_DEFAULT,
  reflowComponents: DEFAULT_REFLOW_COMPONENT_PREFERENCES,
  reflowFontSize: REFLOW_FONT_SIZE_DEFAULT,
  reflowTranslationMode: 'source',
  reflowHoverSourceEnabled: true,
  showRegions: false,
  pageDisplayMode: 'single' as const,
  pageTurningMode: 'scroll',
};

export function readStoredReaderPreferences(): ReaderPreferences {
  if (typeof window === 'undefined') {
    return DEFAULT_READER_PREFERENCES;
  }

  try {
    const raw = window.localStorage.getItem(READER_PREFERENCES_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_READER_PREFERENCES;
    }

    return normalizeReaderPreferences(JSON.parse(raw));
  } catch {
    return DEFAULT_READER_PREFERENCES;
  }
}

export function persistReaderPreferences(preferences: ReaderPreferences) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(
    READER_PREFERENCES_STORAGE_KEY,
    JSON.stringify(normalizeReaderPreferences(preferences))
  );
}

export function equalReaderPreferences(left: ReaderPreferences, right: ReaderPreferences) {
  return (
    left.openEntryPdfByDefault === right.openEntryPdfByDefault &&
    left.autoTranslateTextSelection === right.autoTranslateTextSelection &&
    left.closeSegmentOverlayOnBlankClick === right.closeSegmentOverlayOnBlankClick &&
    left.closeSegmentOverlayOnSameSegmentClick ===
      right.closeSegmentOverlayOnSameSegmentClick &&
    left.hoverPreviewEnabled === right.hoverPreviewEnabled &&
    left.pdfHoverPreviewFontSize === right.pdfHoverPreviewFontSize &&
    left.pdfHoverPreviewSize === right.pdfHoverPreviewSize &&
    left.hoverPreviewShowRegion === right.hoverPreviewShowRegion &&
    left.hoverPreviewShowOriginal === right.hoverPreviewShowOriginal &&
    left.hoverPreviewShowNote === right.hoverPreviewShowNote &&
    left.hoverPreviewShowAnnotation === right.hoverPreviewShowAnnotation &&
    left.hoverPreviewShowTranslation === right.hoverPreviewShowTranslation &&
    left.leftClickOpensNotePane === right.leftClickOpensNotePane &&
    left.segmentNoteOpenGesture === right.segmentNoteOpenGesture &&
    left.reflowBackgroundColor === right.reflowBackgroundColor &&
    equalReflowComponentPreferences(left.reflowComponents, right.reflowComponents) &&
    left.reflowFontSize === right.reflowFontSize &&
    left.reflowTranslationMode === right.reflowTranslationMode &&
    left.reflowHoverSourceEnabled === right.reflowHoverSourceEnabled &&
    left.showRegions === right.showRegions &&
    left.pageDisplayMode === right.pageDisplayMode &&
    (left.pageTurningMode ?? 'scroll') === (right.pageTurningMode ?? 'scroll')
  );
}

function normalizeReaderPreferences(value: unknown): ReaderPreferences {
  if (!value || typeof value !== 'object') {
    return DEFAULT_READER_PREFERENCES;
  }

  const candidate = value as Partial<ReaderPreferences>;

  return {
    openEntryPdfByDefault:
      typeof candidate.openEntryPdfByDefault === 'boolean'
        ? candidate.openEntryPdfByDefault
        : DEFAULT_READER_PREFERENCES.openEntryPdfByDefault,
    autoTranslateTextSelection:
      typeof candidate.autoTranslateTextSelection === 'boolean'
        ? candidate.autoTranslateTextSelection
        : DEFAULT_READER_PREFERENCES.autoTranslateTextSelection,
    closeSegmentOverlayOnBlankClick:
      typeof candidate.closeSegmentOverlayOnBlankClick === 'boolean'
        ? candidate.closeSegmentOverlayOnBlankClick
        : DEFAULT_READER_PREFERENCES.closeSegmentOverlayOnBlankClick,
    closeSegmentOverlayOnSameSegmentClick:
      typeof candidate.closeSegmentOverlayOnSameSegmentClick === 'boolean'
        ? candidate.closeSegmentOverlayOnSameSegmentClick
        : DEFAULT_READER_PREFERENCES.closeSegmentOverlayOnSameSegmentClick,
    hoverPreviewEnabled:
      typeof candidate.hoverPreviewEnabled === 'boolean'
        ? candidate.hoverPreviewEnabled
        : DEFAULT_READER_PREFERENCES.hoverPreviewEnabled,
    pdfHoverPreviewFontSize:
      candidate.pdfHoverPreviewFontSize === 'small' ||
      candidate.pdfHoverPreviewFontSize === 'standard' ||
      candidate.pdfHoverPreviewFontSize === 'large'
        ? candidate.pdfHoverPreviewFontSize
        : DEFAULT_READER_PREFERENCES.pdfHoverPreviewFontSize,
    pdfHoverPreviewSize:
      candidate.pdfHoverPreviewSize === 'compact' ||
      candidate.pdfHoverPreviewSize === 'standard' ||
      candidate.pdfHoverPreviewSize === 'large'
        ? candidate.pdfHoverPreviewSize
        : DEFAULT_READER_PREFERENCES.pdfHoverPreviewSize,
    hoverPreviewShowRegion:
      typeof candidate.hoverPreviewShowRegion === 'boolean'
        ? candidate.hoverPreviewShowRegion
        : DEFAULT_READER_PREFERENCES.hoverPreviewShowRegion,
    hoverPreviewShowOriginal:
      typeof candidate.hoverPreviewShowOriginal === 'boolean'
        ? candidate.hoverPreviewShowOriginal
        : DEFAULT_READER_PREFERENCES.hoverPreviewShowOriginal,
    hoverPreviewShowNote:
      typeof candidate.hoverPreviewShowNote === 'boolean'
        ? candidate.hoverPreviewShowNote
        : DEFAULT_READER_PREFERENCES.hoverPreviewShowNote,
    hoverPreviewShowAnnotation:
      typeof candidate.hoverPreviewShowAnnotation === 'boolean'
        ? candidate.hoverPreviewShowAnnotation
        : DEFAULT_READER_PREFERENCES.hoverPreviewShowAnnotation,
    hoverPreviewShowTranslation:
      typeof candidate.hoverPreviewShowTranslation === 'boolean'
        ? candidate.hoverPreviewShowTranslation
        : DEFAULT_READER_PREFERENCES.hoverPreviewShowTranslation,
    leftClickOpensNotePane:
      typeof candidate.leftClickOpensNotePane === 'boolean'
        ? candidate.leftClickOpensNotePane
        : DEFAULT_READER_PREFERENCES.leftClickOpensNotePane,
    segmentNoteOpenGesture:
      candidate.segmentNoteOpenGesture === 'single' || candidate.segmentNoteOpenGesture === 'modifier'
        ? candidate.segmentNoteOpenGesture
        : (candidate.segmentNoteOpenGesture as unknown) === 'double'
          ? 'button'
        : candidate.leftClickOpensNotePane === true
          ? 'single'
          : DEFAULT_READER_PREFERENCES.segmentNoteOpenGesture,
    reflowBackgroundColor: normalizeReflowBackgroundColor(candidate.reflowBackgroundColor),
    reflowComponents: normalizeReflowComponentPreferences(candidate.reflowComponents),
    reflowFontSize: normalizeReflowFontSize(candidate.reflowFontSize),
    reflowTranslationMode:
      candidate.reflowTranslationMode === 'translation' || candidate.reflowTranslationMode === 'bilingual'
        ? candidate.reflowTranslationMode
        : DEFAULT_READER_PREFERENCES.reflowTranslationMode,
    reflowHoverSourceEnabled:
      typeof candidate.reflowHoverSourceEnabled === 'boolean'
        ? candidate.reflowHoverSourceEnabled
        : DEFAULT_READER_PREFERENCES.reflowHoverSourceEnabled,
    showRegions:
      typeof candidate.showRegions === 'boolean'
        ? candidate.showRegions
        : DEFAULT_READER_PREFERENCES.showRegions,
    pageDisplayMode:
      candidate.pageDisplayMode === 'single' || candidate.pageDisplayMode === 'dual'
        ? candidate.pageDisplayMode
        : DEFAULT_READER_PREFERENCES.pageDisplayMode,
    pageTurningMode: candidate.pageTurningMode === 'book' ? 'book' : 'scroll',
  };
}

export function normalizeReflowFontSize(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return REFLOW_FONT_SIZE_DEFAULT;
  }

  return Math.min(
    REFLOW_FONT_SIZE_MAX,
    Math.max(REFLOW_FONT_SIZE_MIN, Math.round(value))
  );
}

export function normalizeReflowBackgroundColor(value: unknown) {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) {
    return REFLOW_BACKGROUND_COLOR_DEFAULT;
  }

  return value.toLowerCase();
}

export function reflowTextSizeScale(size: ReflowComponentTextSize) {
  return size === 'small' ? 0.86 : size === 'large' ? 1.18 : 1;
}

function normalizeReflowComponentPreferences(value: unknown): ReflowComponentPreferences {
  const candidate = value && typeof value === 'object'
    ? value as Partial<ReflowComponentPreferences>
    : {};

  return {
    heading: normalizeTextComponent(candidate.heading, DEFAULT_REFLOW_COMPONENT_PREFERENCES.heading),
    ...(candidate.content ? { content: normalizeReflowComponentContent(candidate.content) } : {}),
    paragraph: normalizeTextComponent(candidate.paragraph, DEFAULT_REFLOW_COMPONENT_PREFERENCES.paragraph),
    list: normalizeTextComponent(candidate.list, DEFAULT_REFLOW_COMPONENT_PREFERENCES.list),
    table: normalizeTextComponent(candidate.table, DEFAULT_REFLOW_COMPONENT_PREFERENCES.table),
    math: normalizeTextComponent(candidate.math, DEFAULT_REFLOW_COMPONENT_PREFERENCES.math),
    code: normalizeTextComponent(candidate.code, DEFAULT_REFLOW_COMPONENT_PREFERENCES.code),
    supportingText: normalizeTextComponent(
      candidate.supportingText,
      DEFAULT_REFLOW_COMPONENT_PREFERENCES.supportingText
    ),
    figure: normalizeVisualComponent(candidate.figure, DEFAULT_REFLOW_COMPONENT_PREFERENCES.figure),
    chart: normalizeVisualComponent(candidate.chart, DEFAULT_REFLOW_COMPONENT_PREFERENCES.chart),
    diagramVisible:
      typeof candidate.diagramVisible === 'boolean'
        ? candidate.diagramVisible
        : DEFAULT_REFLOW_COMPONENT_PREFERENCES.diagramVisible,
    imageClickToOpen:
      typeof candidate.imageClickToOpen === 'boolean'
        ? candidate.imageClickToOpen
        : DEFAULT_REFLOW_COMPONENT_PREFERENCES.imageClickToOpen
  };
}

function normalizeTextComponent(
  value: unknown,
  fallback: ReflowTextComponentPreference
): ReflowTextComponentPreference {
  const candidate = value && typeof value === 'object'
    ? value as Partial<ReflowTextComponentPreference>
    : {};
  return {
    visible: typeof candidate.visible === 'boolean' ? candidate.visible : fallback.visible,
    size:
      candidate.size === 'small' || candidate.size === 'large'
        ? candidate.size
        : fallback.size
  };
}

function normalizeVisualComponent(
  value: unknown,
  fallback: ReflowVisualComponentPreference
): ReflowVisualComponentPreference {
  const candidate = value && typeof value === 'object'
    ? value as Partial<ReflowVisualComponentPreference>
    : {};
  return {
    visible: typeof candidate.visible === 'boolean' ? candidate.visible : fallback.visible,
    size:
      candidate.size === 'compact' ||
      candidate.size === 'large' ||
      candidate.size === 'full'
        ? candidate.size
        : fallback.size
  };
}

function equalReflowComponentPreferences(
  left: ReflowComponentPreferences,
  right: ReflowComponentPreferences
) {
  return JSON.stringify(left) === JSON.stringify(right);
}
