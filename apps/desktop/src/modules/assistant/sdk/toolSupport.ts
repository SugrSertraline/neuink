// Compatibility entry point. Implementations depend on their owning modules, not this facade.
export {
  scopedEnabledToolIds,
  isAllowedMcpTool,
  normalizeToolInput,
  mcpToolIdsForAgent,
  proposalToolInput,
  scopedEntryIds,
  entryIdOrSingleScope,
  clampTopK,
  clampNumber,
  searchMode,
  publicInput
} from './toolInput';
export {
  executeTool,
  runningSummary
} from './toolExecution';
export {
  readCurrentNoteOutput,
  numberMarkdownLines,
  formatSearchSegmentsOutput,
  formatReadSegmentOutput,
  formatSciverseContentOutput,
  sourceFromEvidence,
  trimSciverseJson
} from './toolOutput';
export {
  noteProposalInputSchema,
  readCurrentNoteInputSchema,
  tagProposalInputSchema,
  runSubagentInputSchema,
  modelToolName,
  assertModelToolNameAvailable,
  assertValidModelToolNames,
  proposalToolDescription,
  modelInputSchema,
  cloneJsonSchema,
  describeProperty,
  toolDescription
} from './toolSchema';
export {
  buildNoteProposal,
  noteProposalAction,
  noteProposalTargetKind,
  segmentTargetFromPlan,
  markersFromMarkdown,
  sourcesFromMarkers,
  noteProposalSummary
} from './toolNoteProposal';
export {
  proposalBeforeMarkdown,
  proposalAfterMarkdown,
  appendMarkdownPreview,
  prependMarkdownPreview,
  ensureTrailingNewlinePreview,
  applyMarkdownPatchPreview,
  countOccurrences,
  markdownPatchOperations,
  patchOperationsPreview
} from './noteProposalPreview';
export {
  asObject,
  isPlainObject,
  requiredString,
  requiredStringAllowEmpty,
  requiredPositiveLine,
  requiredEnum,
  optionalString,
  optionalNumber,
  stringArray,
  maxMarker,
  sourceKey,
  noteSnapshotKey,
  rememberReadNote,
  compactQuote,
  trimToBudget,
  errorMessage
} from './toolValues';
export { formatSciverseSearchOutput } from './sciverseOutput';
export { formatReadEntryOutput } from './entryContext';
