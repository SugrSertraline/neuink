/** Old persisted IDs are accepted only at storage/history boundaries. New calls use one name. */
const LEGACY_TOOL_IDS: Readonly<Record<string, string>> = {
  'app.set_appearance': 'app_set_appearance',
  'note.propose_create': 'note_propose_create',
  'note.propose_patch': 'note_propose_patch',
  'segment_note.propose_patch': 'segment_note_propose_patch',
  'entry.propose_meta_patch': 'entry_propose_meta_patch',
  'tag.propose_change': 'tag_propose_change',
  'task.run_subagent': 'task_run_subagent'
};
const LEGACY_BY_NAME = new Map(Object.entries(LEGACY_TOOL_IDS).map(([old, name]) => [name, old]));
const PROPOSAL_TOOLS = new Set([
  'note_propose_create', 'note_propose_patch', 'segment_note_propose_patch',
  'entry_propose_meta_patch', 'tag_propose_change'
]);

export function canonicalAssistantToolId(id: string): string {
  return Object.prototype.hasOwnProperty.call(LEGACY_TOOL_IDS, id) ? LEGACY_TOOL_IDS[id] : id;
}

export function isProposalTool(id: string): boolean {
  return PROPOSAL_TOOLS.has(canonicalAssistantToolId(id));
}

/** Only for verifying pre-rename execution identities, never for live tool calls. */
export function legacyAssistantToolId(id: string): string {
  return LEGACY_BY_NAME.get(id) ?? id;
}
