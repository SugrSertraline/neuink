export type ReaderPreferences = {
  autoTranslateTextSelection: boolean;
  closeSegmentOverlayOnBlankClick: boolean;
  closeSegmentOverlayOnSameSegmentClick: boolean;
  hoverPreviewEnabled: boolean;
  hoverPreviewShowRegion: boolean;
  hoverPreviewShowOriginal: boolean;
  hoverPreviewShowNote: boolean;
  hoverPreviewShowAnnotation: boolean;
  hoverPreviewShowTranslation: boolean;
  leftClickOpensNotePane: boolean;
  reflowTranslationMode: 'source' | 'translation' | 'bilingual';
  reflowHoverSourceEnabled: boolean;
  showRegions: boolean;
};

const READER_PREFERENCES_STORAGE_KEY = 'neuink.reader.preferences';

const DEFAULT_READER_PREFERENCES: ReaderPreferences = {
  autoTranslateTextSelection: false,
  closeSegmentOverlayOnBlankClick: true,
  closeSegmentOverlayOnSameSegmentClick: true,
  hoverPreviewEnabled: true,
  hoverPreviewShowRegion: true,
  hoverPreviewShowOriginal: true,
  hoverPreviewShowNote: true,
  hoverPreviewShowAnnotation: true,
  hoverPreviewShowTranslation: true,
  leftClickOpensNotePane: true,
  reflowTranslationMode: 'source',
  reflowHoverSourceEnabled: true,
  showRegions: false
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
    left.autoTranslateTextSelection === right.autoTranslateTextSelection &&
    left.closeSegmentOverlayOnBlankClick === right.closeSegmentOverlayOnBlankClick &&
    left.closeSegmentOverlayOnSameSegmentClick ===
      right.closeSegmentOverlayOnSameSegmentClick &&
    left.hoverPreviewEnabled === right.hoverPreviewEnabled &&
    left.hoverPreviewShowRegion === right.hoverPreviewShowRegion &&
    left.hoverPreviewShowOriginal === right.hoverPreviewShowOriginal &&
    left.hoverPreviewShowNote === right.hoverPreviewShowNote &&
    left.hoverPreviewShowAnnotation === right.hoverPreviewShowAnnotation &&
    left.hoverPreviewShowTranslation === right.hoverPreviewShowTranslation &&
    left.leftClickOpensNotePane === right.leftClickOpensNotePane &&
    left.reflowTranslationMode === right.reflowTranslationMode &&
    left.reflowHoverSourceEnabled === right.reflowHoverSourceEnabled &&
    left.showRegions === right.showRegions
  );
}

function normalizeReaderPreferences(value: unknown): ReaderPreferences {
  if (!value || typeof value !== 'object') {
    return DEFAULT_READER_PREFERENCES;
  }

  const candidate = value as Partial<ReaderPreferences>;

  return {
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
        : DEFAULT_READER_PREFERENCES.showRegions
  };
}
