import type { TagMeta } from '@/shared/types/domain';

export type TagCountEntry = {
  tagIds: string[];
};

export type TagNode = {
  children: TagNode[];
  count: number;
  depth: number;
  id: string;
  name: string;
  parentId: string | null;
  path: string;
};

type MutableTagNode = Omit<TagNode, 'children' | 'depth' | 'path'> & {
  children: MutableTagNode[];
};

export function buildTagTree(tags: TagMeta[], entries: TagCountEntry[] = []) {
  const nodeById = new Map<string, MutableTagNode>();

  for (const tag of tags) {
    nodeById.set(tag.id, {
      children: [],
      count: 0,
      id: tag.id,
      name: tag.name,
      parentId: tag.parent_id
    });
  }

  for (const entry of entries) {
    for (const tagId of entry.tagIds) {
      let current = nodeById.get(tagId);
      const visited = new Set<string>();
      while (current && !visited.has(current.id)) {
        visited.add(current.id);
        current.count += 1;
        current = current.parentId ? nodeById.get(current.parentId) : undefined;
      }
    }
  }

  const roots: MutableTagNode[] = [];
  for (const node of nodeById.values()) {
    const parent = node.parentId ? nodeById.get(node.parentId) : null;
    if (parent && parent.id !== node.id) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots.map((node) => finalizeTagNode(node, '', 0)).sort(compareTagNode);
}

export function flattenTagTree(nodes: TagNode[]): TagNode[] {
  return nodes.flatMap((node) => [node, ...flattenTagTree(node.children)]);
}

export function buildTagPathById(tags: TagMeta[]) {
  const tagById = new Map(tags.map((tag) => [tag.id, tag]));
  const pathById = new Map<string, string>();

  const resolvePath = (tag: TagMeta, visited = new Set<string>()): string => {
    if (pathById.has(tag.id)) {
      return pathById.get(tag.id) ?? tag.name;
    }
    if (visited.has(tag.id)) {
      return tag.name;
    }
    visited.add(tag.id);
    const parent = tag.parent_id ? tagById.get(tag.parent_id) : null;
    const path = parent ? `${resolvePath(parent, visited)}/${tag.name}` : tag.name;
    pathById.set(tag.id, path);
    return path;
  };

  for (const tag of tags) {
    resolvePath(tag);
  }

  return pathById;
}

export function collectDescendantTagIds(tags: TagMeta[], tagId: string) {
  const ids = new Set<string>([tagId]);
  let changed = true;

  while (changed) {
    changed = false;
    for (const tag of tags) {
      if (tag.parent_id && ids.has(tag.parent_id) && !ids.has(tag.id)) {
        ids.add(tag.id);
        changed = true;
      }
    }
  }

  return ids;
}

function finalizeTagNode(node: MutableTagNode, parentPath: string, depth: number): TagNode {
  const path = parentPath ? `${parentPath}/${node.name}` : node.name;
  return {
    children: node.children.map((child) => finalizeTagNode(child, path, depth + 1)).sort(compareTagNode),
    count: node.count,
    depth,
    id: node.id,
    name: node.name,
    parentId: node.parentId,
    path
  };
}

function compareTagNode(left: TagNode, right: TagNode) {
  return left.name.localeCompare(right.name);
}
