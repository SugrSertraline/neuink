export type ContentPaneId = 'left' | 'right';

export type EditorGroup = {
  id: ContentPaneId;
  tabIds: string[];
  activeTabId: string | null;
  width?: number;
};

export type EditorLayoutState = {
  groups: EditorGroup[];
  activeGroupId: ContentPaneId;
};

export type EditorLayoutAction =
  | { type: 'openTab'; tabId: string; targetGroupId?: ContentPaneId }
  | { type: 'activateTab'; tabId: string }
  | { type: 'closeTab'; tabId: string }
  | { type: 'closeTabs'; tabIds: string[] }
  | { type: 'reorderTab'; groupId: ContentPaneId; fromIndex: number; toIndex: number }
  | { type: 'dropTab'; tabId: string; targetGroupId: ContentPaneId; targetIndex?: number }
  | { type: 'moveTab'; tabId: string; targetGroupId: ContentPaneId }
  | { type: 'resizeGroup'; groupId: ContentPaneId; width: number };

export const initialEditorLayout: EditorLayoutState = {
  activeGroupId: 'left',
  groups: [{ id: 'left', tabIds: [], activeTabId: null }]
};

export function editorLayoutReducer(
  state: EditorLayoutState,
  action: EditorLayoutAction
): EditorLayoutState {
  switch (action.type) {
    case 'openTab':
      return openTab(state, action.tabId, action.targetGroupId);
    case 'activateTab':
      return activateTab(state, action.tabId);
    case 'closeTab':
      return closeTabs(state, [action.tabId]);
    case 'closeTabs':
      return closeTabs(state, action.tabIds);
    case 'reorderTab':
      return reorderTab(state, action.groupId, action.fromIndex, action.toIndex);
    case 'dropTab':
      return dropTab(state, action.tabId, action.targetGroupId, action.targetIndex);
    case 'moveTab':
      return moveTab(state, action.tabId, action.targetGroupId);
    case 'resizeGroup':
      return normalizeState({
        ...state,
        groups: state.groups.map((group) =>
          group.id === action.groupId ? { ...group, width: action.width } : group
        )
      });
    default:
      return state;
  }
}

export function editorLayoutIsSplit(state: EditorLayoutState) {
  return Boolean(getEditorGroup(state, 'right'));
}

export function getEditorGroup(state: EditorLayoutState, groupId: ContentPaneId) {
  return state.groups.find((group) => group.id === groupId) ?? null;
}

export function getEditorGroupTabIds(state: EditorLayoutState, groupId: ContentPaneId) {
  return getEditorGroup(state, groupId)?.tabIds ?? [];
}

export function getEditorGroupActiveTabId(state: EditorLayoutState, groupId: ContentPaneId) {
  return getEditorGroup(state, groupId)?.activeTabId ?? null;
}

export function getOpenEditorTabIds(state: EditorLayoutState) {
  return state.groups.flatMap((group) => group.tabIds);
}

export function getTabEditorGroupId(
  state: EditorLayoutState,
  tabId: string
): ContentPaneId | null {
  return state.groups.find((group) => group.tabIds.includes(tabId))?.id ?? null;
}

export function getEditorGroupWidth(state: EditorLayoutState, groupId: ContentPaneId) {
  return getEditorGroup(state, groupId)?.width ?? null;
}

export function getNextActiveTabAfterClosing(
  state: EditorLayoutState,
  closingTabIds: string[],
  currentActiveTab: string
) {
  const closingSet = new Set(closingTabIds);
  if (!closingSet.has(currentActiveTab)) {
    return currentActiveTab;
  }

  const tabGroup = state.groups.find((group) => group.tabIds.includes(currentActiveTab));
  if (tabGroup) {
    const remainingTabs = tabGroup.tabIds.filter((tabId) => !closingSet.has(tabId));
    const closingIndex = tabGroup.tabIds.findIndex((tabId) => closingSet.has(tabId));
    const nextInGroup =
      remainingTabs[Math.min(Math.max(closingIndex, 0), remainingTabs.length - 1)] ?? null;
    if (nextInGroup) {
      return nextInGroup;
    }
  }

  for (const group of state.groups) {
    const candidate = group.tabIds.find((tabId) => !closingSet.has(tabId));
    if (candidate) {
      return candidate;
    }
  }

  return 'library';
}

function openTab(
  state: EditorLayoutState,
  tabId: string,
  targetGroupId?: ContentPaneId
): EditorLayoutState {
  const existingGroupId = getTabEditorGroupId(state, tabId);
  const groupId = targetGroupId ?? existingGroupId ?? state.activeGroupId;
  const groups = ensureGroup(removeTabFromGroups(state.groups, tabId), groupId).map((group) => {
    if (group.id !== groupId) {
      return group;
    }
    return {
      ...group,
      tabIds: group.tabIds.includes(tabId) ? group.tabIds : [...group.tabIds, tabId],
      activeTabId: tabId
    };
  });

  return normalizeState({
    activeGroupId: groupId,
    groups
  });
}

function activateTab(state: EditorLayoutState, tabId: string): EditorLayoutState {
  const groupId = getTabEditorGroupId(state, tabId);
  if (!groupId) {
    return state;
  }

  return normalizeState({
    activeGroupId: groupId,
    groups: state.groups.map((group) =>
      group.id === groupId ? { ...group, activeTabId: tabId } : group
    )
  });
}

function closeTabs(state: EditorLayoutState, tabIds: string[]): EditorLayoutState {
  if (tabIds.length === 0) {
    return state;
  }

  const closingSet = new Set(tabIds);
  const nextGroups = state.groups.map((group) => {
    const nextTabIds = group.tabIds.filter((tabId) => !closingSet.has(tabId));
    const activeTabId = closingSet.has(group.activeTabId ?? '')
      ? nextTabIds[Math.min(group.tabIds.indexOf(group.activeTabId ?? ''), nextTabIds.length - 1)] ?? null
      : group.activeTabId && nextTabIds.includes(group.activeTabId)
        ? group.activeTabId
        : nextTabIds[0] ?? null;
    return { ...group, tabIds: nextTabIds, activeTabId };
  });

  return normalizeState({
    activeGroupId: state.activeGroupId,
    groups: nextGroups
  });
}

function moveTab(
  state: EditorLayoutState,
  tabId: string,
  targetGroupId: ContentPaneId
): EditorLayoutState {
  if (!getTabEditorGroupId(state, tabId)) {
    return state;
  }

  return openTab(state, tabId, targetGroupId);
}

function reorderTab(
  state: EditorLayoutState,
  groupId: ContentPaneId,
  fromIndex: number,
  toIndex: number
): EditorLayoutState {
  const group = getEditorGroup(state, groupId);
  if (!group || fromIndex === toIndex) {
    return state;
  }
  if (
    fromIndex < 0 ||
    fromIndex >= group.tabIds.length ||
    toIndex < 0 ||
    toIndex >= group.tabIds.length
  ) {
    return state;
  }

  const tabIds = [...group.tabIds];
  const [tabId] = tabIds.splice(fromIndex, 1);
  tabIds.splice(toIndex, 0, tabId);

  return normalizeState({
    activeGroupId: groupId,
    groups: state.groups.map((candidate) =>
      candidate.id === groupId ? { ...candidate, tabIds } : candidate
    )
  });
}

function dropTab(
  state: EditorLayoutState,
  tabId: string,
  targetGroupId: ContentPaneId,
  targetIndex = Number.POSITIVE_INFINITY
): EditorLayoutState {
  const sourceGroupId = getTabEditorGroupId(state, tabId);
  if (!sourceGroupId) {
    return state;
  }
  const sourceGroup = getEditorGroup(state, sourceGroupId);
  const sourceIndex = sourceGroup?.tabIds.indexOf(tabId) ?? -1;

  const groups = ensureGroup(removeTabFromGroups(state.groups, tabId), targetGroupId).map((group) => {
    if (group.id !== targetGroupId) {
      return group;
    }
    const normalizedTargetIndex = Math.trunc(targetIndex);
    const adjustedTargetIndex =
      sourceGroupId === targetGroupId && sourceIndex >= 0 && sourceIndex < normalizedTargetIndex
        ? normalizedTargetIndex - 1
        : normalizedTargetIndex;
    const insertAt = Math.min(Math.max(adjustedTargetIndex, 0), group.tabIds.length);
    const tabIds = [...group.tabIds];
    tabIds.splice(insertAt, 0, tabId);
    return { ...group, tabIds, activeTabId: tabId };
  });

  return normalizeState({
    activeGroupId: targetGroupId,
    groups
  });
}

function ensureGroup(groups: EditorGroup[], groupId: ContentPaneId) {
  if (groups.some((group) => group.id === groupId)) {
    return groups;
  }
  return [...groups, { id: groupId, tabIds: [], activeTabId: null }];
}

function removeTabFromGroups(groups: EditorGroup[], tabId: string) {
  return groups.map((group) => {
    if (!group.tabIds.includes(tabId)) {
      return group;
    }
    const tabIds = group.tabIds.filter((candidate) => candidate !== tabId);
    return {
      ...group,
      tabIds,
      activeTabId: group.activeTabId === tabId ? tabIds[0] ?? null : group.activeTabId
    };
  });
}

function normalizeState(state: EditorLayoutState): EditorLayoutState {
  const groups = normalizeGroups(state.groups);
  const activeGroup = groups.find((group) => group.id === state.activeGroupId) ?? null;
  const activeGroupId = activeGroup?.activeTabId
    ? activeGroup.id
    : groups.find((group) => group.activeTabId)?.id ?? 'left';
  return { activeGroupId, groups };
}

function normalizeGroups(groups: EditorGroup[]) {
  const byId = new Map(groups.map((group) => [group.id, group]));
  const left = byId.get('left') ?? { id: 'left' as const, tabIds: [], activeTabId: null };
  const right = byId.get('right') ?? null;
  return [
    normalizeGroup(left),
    ...(right && right.tabIds.length > 0 ? [normalizeGroup(right)] : [])
  ];
}

function normalizeGroup(group: EditorGroup): EditorGroup {
  const activeTabId =
    group.activeTabId && group.tabIds.includes(group.activeTabId)
      ? group.activeTabId
      : group.tabIds[0] ?? null;
  return { ...group, activeTabId };
}
