import { BookOpen, CircleHelp, Workflow, Puzzle, SlidersHorizontal, Lightbulb, ChartNoAxesCombined, TriangleAlert, FlaskConical } from 'lucide-react';
import type { CardKind } from '@/shared/ipc/ideationApi';
import { compactCardLabels } from './cardPresentation';
const icons = { background: BookOpen, problem: CircleHelp, method: Workflow, component: Puzzle, constraint: SlidersHorizontal, assumption: Lightbulb, result: ChartNoAxesCombined, limitation: TriangleAlert, idea: FlaskConical };
export function CardTypeLabel({ kind }: { kind: CardKind }) {
  const Icon = icons[kind];
  return <span className="inline-flex items-center gap-1.5 align-middle"><Icon className="size-3.5 shrink-0" aria-hidden="true" /><span>{compactCardLabels[kind]}</span></span>;
}
