import type { TagMemberStatus, TagReadingMember, TagReadingState } from '@/shared/ipc/tagReadingApi';

export const tagMemberLabels: Record<TagMemberStatus, string> = { unread: '未读', reading: '阅读中', done: '已读', skipped: '跳过' };
export const isReadableMember = (member: TagReadingMember) => member.pdf_available || member.reflow_available;

export function orderedMembers(state: TagReadingState, members: TagReadingMember[]) {
  return members.map((member, index) => ({ member, index })).sort((a, b) =>
    (state.member_states[a.member.entry_id]?.order ?? Number.MAX_SAFE_INTEGER) -
    (state.member_states[b.member.entry_id]?.order ?? Number.MAX_SAFE_INTEGER) || a.index - b.index
  ).map(({ member }) => member);
}

export function reconcileTagReading(state: TagReadingState, members: TagReadingMember[], restoreSelection: boolean): TagReadingState {
  const member_states = { ...state.member_states };
  let order = Object.values(member_states).reduce((maximum, member) => Math.max(maximum, member.order), -1) + 1;
  for (const member of members) {
    member_states[member.entry_id] ??= { status: 'unread', order: order++, updated_at: state.updated_at };
  }
  const next = { ...state, member_states };
  const readable = orderedMembers(next, members).filter(isReadableMember);
  if (restoreSelection) {
    if (!readable.some((member) => member.entry_id === next.active_entry_id)) {
      next.active_entry_id = readable.find((member) => member_states[member.entry_id]?.status === 'reading')?.entry_id ??
        readable.find((member) => member_states[member.entry_id]?.status === 'unread')?.entry_id ?? readable[0]?.entry_id ?? null;
    }
    if (!readable.some((member) => member.entry_id === next.compare_entry_id) || next.compare_entry_id === next.active_entry_id) next.compare_entry_id = null;
  }
  return next;
}

export function selectReadingEntry(state: TagReadingState, entryId: string): TagReadingState {
  return { ...state, active_entry_id: entryId, compare_entry_id: state.compare_entry_id === entryId ? state.active_entry_id : state.compare_entry_id };
}

export function markMember(state: TagReadingState, entryId: string, status: TagMemberStatus): TagReadingState {
  const member = state.member_states[entryId];
  if (!member) return state;
  return { ...state, member_states: { ...state.member_states, [entryId]: { ...member, status, updated_at: new Date().toISOString() } } };
}

export function finishAndContinue(state: TagReadingState, members: TagReadingMember[]) {
  if (!state.active_entry_id) return state;
  const next = markMember(state, state.active_entry_id, 'done');
  const queue = orderedMembers(next, members).filter(isReadableMember);
  const current = queue.findIndex((member) => member.entry_id === state.active_entry_id);
  const candidates = [...queue.slice(current + 1), ...queue.slice(0, current + 1)];
  const target = candidates.find((member) => member.entry_id !== state.compare_entry_id && next.member_states[member.entry_id]?.status === 'unread');
  return target ? { ...next, active_entry_id: target.entry_id } : next;
}

export function moveReadingMember(state: TagReadingState, members: TagReadingMember[], entryId: string, delta: -1 | 1) {
  const queue = orderedMembers(state, members);
  const index = queue.findIndex((member) => member.entry_id === entryId);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= queue.length) return state;
  [queue[index], queue[target]] = [queue[target], queue[index]];
  const member_states = { ...state.member_states };
  queue.forEach((member, order) => { member_states[member.entry_id] = { ...member_states[member.entry_id], order }; });
  return { ...state, member_states };
}

export function tagReadingProgress(state: TagReadingState, members: TagReadingMember[]) {
  const readable = members.filter(isReadableMember);
  const count = (status: TagMemberStatus) => readable.filter((member) => state.member_states[member.entry_id]?.status === status).length;
  return { done: count('done'), total: readable.length - count('skipped'), skipped: count('skipped'), unavailable: members.length - readable.length };
}
