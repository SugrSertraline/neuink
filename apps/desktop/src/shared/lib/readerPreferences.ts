import { REFLOW_COMPONENT_KEYS, normalizeReflowComponentContent, type ReflowComponentContent } from './reflowContentPreferences';

/** Percent of the standard preview. Legacy presets are migrated when preferences are loaded. */
export type PdfHoverPreviewFontSize = number;
export type PdfHoverPreviewSize = number;
export type ReadingLinkMode = 'scroll' | 'click';
export const PDF_PREVIEW_FONT_MIN = 80;
export const PDF_PREVIEW_FONT_MAX = 180;
export const PDF_PREVIEW_SIZE_MIN = 60;
export const PDF_PREVIEW_SIZE_MAX = 160;

export function normalizePdfPreviewFontSize(value: unknown): number {
  if (value === 'small') return 85;
  if (value === 'large') return 120;
  return normalizePreviewPercent(value, PDF_PREVIEW_FONT_MIN, PDF_PREVIEW_FONT_MAX);
}

export function normalizePdfPreviewSize(value: unknown): number {
  if (value === 'compact') return 82;
  if (value === 'large') return 120;
  return normalizePreviewPercent(value, PDF_PREVIEW_SIZE_MIN, PDF_PREVIEW_SIZE_MAX);
}

function normalizePreviewPercent(value: unknown, min: number, max: number) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value))) : 100;
}

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
  readingLinkMode?: ReadingLinkMode;
  openEntryPdfByDefault: boolean;
  autoTranslateTextSelection: boolean;
  closeSegmentOverlayOnBlankClick: boolean;
  closeSegmentOverlayOnSameSegmentClick: boolean;
  hoverPreviewEnabled: boolean;
  pdfSentenceHoverEnabled: boolean;
  pdfSentenceHoverShowOriginal: boolean;
  pdfSentenceHoverShowTranslation: boolean;
  pdfHoverPreviewFontSize: PdfHoverPreviewFontSize;
  pdfHoverPreviewSize: PdfHoverPreviewSize;
  hoverPreviewShowRegion: boolean;
  hoverPreviewShowOriginal: boolean;
  hoverPreviewShowNote: boolean;
  hoverPreviewShowAnnotation: boolean;
  inlineAnnotationHoverEnabled: boolean;
  paperReferenceHoverEnabled: boolean;
  hoverPreviewShowTranslation: boolean;
  leftClickOpensNotePane: boolean;
  segmentNoteOpenGesture: 'button' | 'single' | 'modifier';
  reflowBackgroundColor: string;
  reflowComponents: ReflowComponentPreferences;
  reflowFontSize: number;
  reflowTranslationMode: 'source' | 'translation' | 'bilingual' | 'sentences';
  reflowHoverSourceEnabled: boolean;
  showRegions: boolean;
  pageDisplayMode: 'single' | 'dual';
  pageTurningMode?: 'scroll' | 'book';
};

export type ReflowOriginalDisplay = 'hidden' | 'original' | 'sentences';

export function reflowDisplayOptions(preferences: ReaderPreferences) {
  const content = normalizeReflowComponentContent(preferences.reflowComponents.content)?.paragraph;
  const parsed = content?.parsed ?? preferences.reflowTranslationMode !== 'translation';
  const translation = content?.translation ?? preferences.reflowTranslationMode !== 'source';
  const translationView = content?.translationView ?? (preferences.reflowTranslationMode === 'sentences' ? 'sentences' : 'paragraph');
  return {
    original: !parsed ? 'hidden' : translationView === 'sentences' ? 'sentences' : 'original',
    translation,
  } as const;
}

export function withReflowDisplayOptions(preferences: ReaderPreferences, original: ReflowOriginalDisplay,
  translation: boolean): ReaderPreferences {
  const mode: ReaderPreferences['reflowTranslationMode'] = original === 'sentences' ? 'sentences'
    : original === 'hidden' ? 'translation' : translation ? 'bilingual' : 'source';
  return { ...preferences, reflowTranslationMode: mode, reflowComponents: {
    ...preferences.reflowComponents,
    content: Object.fromEntries(REFLOW_COMPONENT_KEYS.map(key => [key, {
      ...preferences.reflowComponents.content?.[key], parsed: original !== 'hidden', translation,
      translationView: original === 'sentences' ? 'sentences' : 'paragraph',
    }])),
  } };
}

export function withReflowTranslationMode(preferences: ReaderPreferences, mode: ReaderPreferences['reflowTranslationMode']): ReaderPreferences {
  return withReflowDisplayOptions(preferences, mode === 'translation' ? 'hidden' : mode === 'sentences' ? 'sentences' : 'original',
    mode !== 'source');
}

const READER_PREFERENCES_STORAGE_KEY = 'neuink.reader.preferences';

const DEFAULT_READER_PREFERENCES: ReaderPreferences = {
  readingLinkMode: 'scroll',
  openEntryPdfByDefault: true,
  autoTranslateTextSelection: false,
  closeSegmentOverlayOnBlankClick: true,
  closeSegmentOverlayOnSameSegmentClick: true,
  hoverPreviewEnabled: true,
  pdfSentenceHoverEnabled: true,
  pdfSentenceHoverShowOriginal: true,
  pdfSentenceHoverShowTranslation: true,
  pdfHoverPreviewFontSize: 100,
  pdfHoverPreviewSize: 100,
  hoverPreviewShowRegion: true,
  hoverPreviewShowOriginal: true,
  hoverPreviewShowNote: true,
  hoverPreviewShowAnnotation: true,
  inlineAnnotationHoverEnabled: true,
  paperReferenceHoverEnabled: true,
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
    (left.readingLinkMode ?? 'scroll') === (right.readingLinkMode ?? 'scroll') &&
    left.openEntryPdfByDefault === right.openEntryPdfByDefault &&
    left.autoTranslateTextSelection === right.autoTranslateTextSelection &&
    left.closeSegmentOverlayOnBlankClick === right.closeSegmentOverlayOnBlankClick &&
    left.closeSegmentOverlayOnSameSegmentClick ===
      right.closeSegmentOverlayOnSameSegmentClick &&
    left.hoverPreviewEnabled === right.hoverPreviewEnabled &&
    left.pdfSentenceHoverEnabled === right.pdfSentenceHoverEnabled &&
    left.pdfSentenceHoverShowOriginal === right.pdfSentenceHoverShowOriginal &&
    left.pdfSentenceHoverShowTranslation === right.pdfSentenceHoverShowTranslation &&
    left.pdfHoverPreviewFontSize === right.pdfHoverPreviewFontSize &&
    left.pdfHoverPreviewSize === right.pdfHoverPreviewSize &&
    left.hoverPreviewShowRegion === right.hoverPreviewShowRegion &&
    left.hoverPreviewShowOriginal === right.hoverPreviewShowOriginal &&
    left.hoverPreviewShowNote === right.hoverPreviewShowNote &&
    left.hoverPreviewShowAnnotation === right.hoverPreviewShowAnnotation &&
    left.inlineAnnotationHoverEnabled === right.inlineAnnotationHoverEnabled &&
    left.paperReferenceHoverEnabled === right.paperReferenceHoverEnabled &&
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
    readingLinkMode: candidate.readingLinkMode === 'click' ? 'click' : 'scroll',
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
    pdfSentenceHoverEnabled:
      typeof candidate.pdfSentenceHoverEnabled === 'boolean'
        ? candidate.pdfSentenceHoverEnabled
        : DEFAULT_READER_PREFERENCES.pdfSentenceHoverEnabled,
    pdfSentenceHoverShowOriginal:
      typeof candidate.pdfSentenceHoverShowOriginal === 'boolean'
        ? candidate.pdfSentenceHoverShowOriginal
        : DEFAULT_READER_PREFERENCES.pdfSentenceHoverShowOriginal,
    pdfSentenceHoverShowTranslation:
      typeof candidate.pdfSentenceHoverShowTranslation === 'boolean'
        ? candidate.pdfSentenceHoverShowTranslation
        : DEFAULT_READER_PREFERENCES.pdfSentenceHoverShowTranslation,
    pdfHoverPreviewFontSize: normalizePdfPreviewFontSize(candidate.pdfHoverPreviewFontSize),
    pdfHoverPreviewSize: normalizePdfPreviewSize(candidate.pdfHoverPreviewSize),
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
    inlineAnnotationHoverEnabled:
      typeof candidate.inlineAnnotationHoverEnabled === 'boolean'
        ? candidate.inlineAnnotationHoverEnabled
        : candidate.hoverPreviewEnabled !== false && candidate.hoverPreviewShowAnnotation !== false,
    paperReferenceHoverEnabled:
      typeof candidate.paperReferenceHoverEnabled === 'boolean'
        ? candidate.paperReferenceHoverEnabled
        : DEFAULT_READER_PREFERENCES.paperReferenceHoverEnabled,
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
      candidate.reflowTranslationMode === 'translation' || candidate.reflowTranslationMode === 'bilingual' || candidate.reflowTranslationMode === 'sentences'
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
