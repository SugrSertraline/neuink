import type { TagDensity } from '@/shared/lib/tagPreferences';
import type { TagNode } from '../utils/tagTree';
import { SidebarTagRow } from './SidebarTagRow';

type SidebarTagTreeItemProps = {
  activeTag: string | null;
  node: TagNode;
  expandedIds: ReadonlySet<string>;
  density: TagDensity;
  showCounts: boolean;
  onToggle: (tagId: string) => void;
  onAssignEntryToTag?: (entryId: string, tagPath: string) => Promise<unknown> | unknown;
  onOpenTagDetails: (tagId: string) => void;
};

export function SidebarTagTreeItem(props: SidebarTagTreeItemProps) {
  const { activeTag, node, expandedIds, density, showCounts, onToggle, onAssignEntryToTag, onOpenTagDetails } = props;
  const open = expandedIds.has(node.id);
  return (
    <div className="min-w-0">
      <SidebarTagRow active={activeTag === node.id} node={node} presentation="tree" density={density} showCounts={showCounts} open={open} onToggle={() => onToggle(node.id)} onAssignEntryToTag={onAssignEntryToTag} onOpenTagDetails={onOpenTagDetails} />
      {node.children.length > 0 && open ? <div className="ml-3 min-w-0 border-l border-border pl-1">
        {node.children.map(child => <SidebarTagTreeItem {...props} key={child.id} node={child} />)}
      </div> : null}
    </div>
  );
}
