import type { IdeationState, Placement } from '@/shared/ipc/ideationApi';
import { branchRules, type BranchSlot } from './ideationBranches';
import { nodeHeight, nodeWidth } from './ideationLayout';

export function hasNodeOverlap(nodes: Placement[]) {
  return nodes.some((a, i) => nodes.slice(i + 1).some(b => a.x < b.x + nodeWidth && a.x + nodeWidth > b.x && a.y < b.y + nodeHeight && a.y + nodeHeight > b.y));
}

/** Only one alternative is displayed at a time, so alternatives share the nearest free position. */
export function positionBranchSlots(state: IdeationState, sourceId: string | null, previous: BranchSlot[] = [], hidden: string[] = [], stacked = false) {
  const source = state.placements.find(p => p.id === sourceId), kind = state.cards.find(c => c.id === source?.card_id)?.kind;
  if (!source || !kind) return [];
  const rules = branchRules[kind].filter(rule => !hidden.includes(rule.id));
  const free = ({ x, y }: { x: number; y: number }) => x >= 0 && y >= 0 && x <= 10000 && y <= 10000 &&
    !state.placements.some(p => x < p.x + nodeWidth + 24 && x + nodeWidth + 24 > p.x && y < p.y + nodeHeight + 24 && y + nodeHeight + 24 > p.y);
  const preferredX = source.x + nodeWidth + 96;
  const xs = [...new Set([preferredX, source.x, preferredX + nodeWidth + 96, source.x - nodeWidth - 96])].filter(x => x >= 0 && x <= 10000);
  const ys = [...new Set([source.y, 0, ...state.placements.flatMap(p => [p.y + nodeHeight + 32, p.y - nodeHeight - 32])])].filter(y => y >= 0 && y <= 10000);
  const distance = ({ x, y }: { x: number; y: number }) => {
    const dx = Math.abs(x - source.x), dy = Math.abs(y - source.y);
    const orientation = stacked ? (dx > 8 ? 180 : 0) + (y < source.y ? 120 : 0) : x <= source.x ? 120 : 0;
    return Math.hypot(Math.max(0, dx - nodeWidth), Math.max(0, dy - nodeHeight)) + (dx + dy) * .1 + orientation;
  };
  // Prefer a short right-hand branch, or a nearby row when that column is occupied.
  const candidates = xs.flatMap(x => ys.map(y => ({ x, y }))).sort((a, b) => distance(a) - distance(b));
  const nearest = candidates.find(free);
  return rules.flatMap(rule => {
    const old = previous.find(slot => slot.id === rule.id && slot.sourceId === sourceId);
    const position = old && free(old) ? old : nearest;
    return position ? [{ ...rule, sourceId: source.id, x: position.x, y: position.y }] : [];
  });
}
