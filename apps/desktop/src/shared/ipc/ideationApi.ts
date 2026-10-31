import { invoke } from '@tauri-apps/api/core';

export type CardKind = 'background' | 'problem' | 'method' | 'component' | 'constraint' | 'assumption' | 'result' | 'limitation' | 'idea';
export type CardSource = { segment_uid: string; page_idx: number; quote: string };
export type PaperCard = { id: string; entry_id: string; title: string; body: string; kind: CardKind; sources?: CardSource[]; origin?: 'ai_draft' | 'ai_reviewed' | 'preset'; pattern_ids?: string[] };
export type IdeationViewport = { x: number; y: number; scale: number };
export type IdeationBoard = { id: string; title: string; description: string; created_at: string; updated_at: string; deleted_at?: string | null; viewport?: IdeationViewport | null };
export type Placement = { id: string; card_id: string; board_id?: string; x: number; y: number; slot?: CardKind | null; locked?: boolean; title?: string | null; body?: string | null };
export type IdeationLinkKind = 'related' | 'addresses' | 'input' | 'combines' | 'contrasts' | 'supports' | 'limits' | 'feedback' | 'hypothesis' | 'alternative' | 'progression' | 'decomposes' | 'depends_on' | 'tests' | 'challenges' | 'motivates';
export type IdeationLink = { id: string; from: string; to: string; kind?: IdeationLinkKind | null; label?: string | null; description?: string; origin?: 'ai_inferred' | 'user'; entry_id?: string; sources?: CardSource[] };
/** Version 1 is accepted for migration only. New writes use version 2 with board ownership. */
export type IdeationState = { version: 1 | 2; cards: PaperCard[]; placements: Placement[]; links?: IdeationLink[]; boards?: IdeationBoard[] };
export type IdeationSnapshot = { revision: string; state: IdeationState };
export type IdeationErrorCode = 'timeout' | 'no_model' | 'no_content' | 'changed' | 'invalid_output' | 'auth' | 'rate_limit' | 'network' | 'model';
export type DraftRelation = { from: string; to: string; kind: IdeationLinkKind; sources: CardSource[] };
export type IdeationDraft = { entry_id: string; status: 'ready' | 'failed'; cards: PaperCard[]; relations?: DraftRelation[]; partial: boolean; model: string; error_code?: IdeationErrorCode | null };
export type IdeationDraftSummary = { entry_id: string; status: 'ready' | 'failed'; count: number; partial: boolean; revision: string; card_ids: string[]; cards: { id: string; kind: CardKind; title: string; body?: string; pattern_ids?: string[] }[]; error_code?: IdeationErrorCode | null };
export type IdeationDraftSnapshot = { revision: string; draft: IdeationDraft | null };

export function readIdeation(root: string) {
  return invoke<IdeationSnapshot>('ideation_workspace', { request: { root, action: { kind: 'read' } } });
}
export function saveIdeation(root: string, expectedRevision: string, state: IdeationState) {
  return invoke<IdeationSnapshot>('ideation_workspace', { request: { root, action: { kind: 'save', expected_revision: expectedRevision, state } } });
}
export function listIdeationDrafts(root: string) {
  return invoke<IdeationDraftSummary[]>('ideation_workspace', { request: { root, action: { kind: 'list_drafts' } } });
}
export function readIdeationDraft(root: string, entryId: string) {
  return invoke<IdeationDraftSnapshot>('ideation_workspace', { request: { root, action: { kind: 'read_draft', entry_id: entryId } } });
}
export function saveIdeationDraft(root: string, expectedRevision: string, draft: IdeationDraft) {
  return invoke<IdeationDraftSnapshot>('ideation_workspace', { request: { root, action: { kind: 'save_draft', expected_revision: expectedRevision, draft } } });
}
