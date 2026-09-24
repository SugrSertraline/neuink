import { FileText, StickyNote, Tag } from 'lucide-react';
import type { RelationNode } from './relationGraph';
export const RelationIcon = ({ kind }: { kind: RelationNode['kind'] }) => kind === 'tag' ? <Tag size={13} aria-hidden="true" />
  : kind === 'entry' ? <FileText size={13} aria-hidden="true" /> : <StickyNote size={13} aria-hidden="true" />;
export const relationNodeLabel = (node: RelationNode) => `${node.kind === 'tag' ? '标签' : node.kind === 'entry' ? '论文' : node.subtitle}：${node.title}`;
