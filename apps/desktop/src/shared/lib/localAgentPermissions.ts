import { useMemo, useSyncExternalStore } from 'react';
import { LOCAL_AGENTS, type LocalAgentProvider } from './localAgentSettings';

export type LocalAgentPermission = { provider: LocalAgentProvider; toolName: string };
export type LocalAgentGrant = LocalAgentPermission & { root: string };

const KEY = 'neuink.localAgent.permissions.v1';
const EVENT = 'neuink:local-agent-permissions';
const UNAVAILABLE = 'storage-unavailable';
const READ_ERROR = '无法读取已保存的授权，当前仍需逐次确认。';

function workspaceKey(root: string) {
  const path = root.replace(/\\/g, '/').replace(/\/+$/, '') || '/';
  return /^[a-z]:\//i.test(path) || path.startsWith('//') ? path.toLowerCase() : path;
}

/** Only stable native tool names can create grants; prompts and tool parameters never do. */
export function localAgentPermission(tool: string): LocalAgentPermission | null {
  const agent = LOCAL_AGENTS.find(value => tool.startsWith(`${value.id}.`));
  const toolName = agent ? tool.slice(agent.id.length + 1) : '';
  if (!agent || !/^[a-zA-Z][\w.:-]{0,159}$/.test(toolName) || toolName === 'AskUserQuestion') return null;
  return { provider: agent.id, toolName };
}

export function localAgentPermissionLabel(toolName: string) {
  const labels: Record<string, string> = {
    Bash: '执行本地命令', Write: '写入文件', Edit: '编辑文件',
    apply_patch: '应用文件修改', patch: '应用文件修改',
    Read: '读取文件', Glob: '查找文件', Grep: '搜索文件内容',
    WebFetch: '读取网页', WebSearch: '搜索网页', ToolSearch: '查找工具',
    Permissions: '申请本地访问权限', Agent: '调用本地子助手',
  };
  return Object.prototype.hasOwnProperty.call(labels, toolName) ? labels[toolName] : toolName;
}

function storedValue() {
  try { return window.localStorage.getItem(KEY); } catch { return UNAVAILABLE; }
}

function parseGrants(raw: string | null): { grants: LocalAgentGrant[]; error: string | null } {
  if (raw === null) return { grants: [], error: null };
  try {
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== 'object' || !('version' in data) || data.version !== 1
      || !('grants' in data) || !Array.isArray(data.grants)) throw new Error();
    const grants: LocalAgentGrant[] = data.grants.map((item: unknown) => {
      if (!item || typeof item !== 'object' || !('root' in item) || typeof item.root !== 'string' || !item.root
        || !('provider' in item) || typeof item.provider !== 'string'
        || !('toolName' in item) || typeof item.toolName !== 'string') throw new Error();
      const permission = localAgentPermission(`${item.provider}.${item.toolName}`);
      if (!permission || permission.provider !== item.provider || permission.toolName !== item.toolName) throw new Error();
      return { root: workspaceKey(item.root), ...permission };
    });
    return { grants, error: null };
  } catch { return { grants: [], error: READ_ERROR }; }
}

function samePermission(grant: LocalAgentGrant, root: string, permission: LocalAgentPermission) {
  return grant.root === workspaceKey(root) && grant.provider === permission.provider && grant.toolName === permission.toolName;
}

export function hasLocalAgentPermission(root: string, permission: LocalAgentPermission) {
  return Boolean(root) && parseGrants(storedValue()).grants.some(grant => samePermission(grant, root, permission));
}

function saveGrants(grants: LocalAgentGrant[]) {
  // Persist before publishing or approving. A failed write must leave the operation pending.
  window.localStorage.setItem(KEY, JSON.stringify({ version: 1, grants }));
  window.dispatchEvent(new Event(EVENT));
}

export function allowLocalAgentPermission(root: string, permission: LocalAgentPermission) {
  if (!root || !localAgentPermission(`${permission.provider}.${permission.toolName}`)) throw new Error('无效的本地授权。');
  const { grants, error } = parseGrants(storedValue());
  if (error) throw new Error(error);
  if (!grants.some(grant => samePermission(grant, root, permission))) {
    saveGrants([...grants, { root: workspaceKey(root), ...permission }]);
  }
}

export function revokeLocalAgentPermission(root: string, permission?: LocalAgentPermission) {
  const { grants, error } = parseGrants(storedValue());
  if (error) throw new Error(error);
  saveGrants(grants.filter(grant => permission ? !samePermission(grant, root, permission) : grant.root !== workspaceKey(root)));
}

function subscribe(listener: () => void) {
  const onStorage = (event: StorageEvent) => { if (event.key === KEY || event.key === null) listener(); };
  window.addEventListener(EVENT, listener);
  window.addEventListener('storage', onStorage);
  return () => { window.removeEventListener(EVENT, listener); window.removeEventListener('storage', onStorage); };
}

/** Shared local preference owns grants; windows reread them for every native request. */
export function useLocalAgentPermissions(root: string | null | undefined) {
  const raw = useSyncExternalStore(subscribe, storedValue, () => null);
  return useMemo(() => {
    const state = parseGrants(raw);
    return { ...state, grants: root ? state.grants.filter(grant => grant.root === workspaceKey(root)) : [] };
  }, [raw, root]);
}
