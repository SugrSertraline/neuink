import { legacyAssistantToolId } from '@/shared/lib/assistantToolNames';

/** Reproduce the old hash input without changing prompts, arguments or model-visible tool names. */
export function legacyToolIdentity(identity: unknown): unknown {
  if (!identity || typeof identity !== 'object' || Array.isArray(identity)) return identity;
  const result = { ...identity } as Record<string, unknown>;
  if (result.agent && typeof result.agent === 'object' && !Array.isArray(result.agent)) {
    result.agent = legacyToolLists(result.agent);
  }
  if (Array.isArray(result.system)) {
    result.system = result.system.map(value => typeof value === 'string' ? legacyCapabilityBoundary(value) : value);
  }
  return result;
}

function legacyToolLists(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    (key === 'enabledToolIds' || key === 'requiredToolIds') && Array.isArray(item)
      ? item.map(id => typeof id === 'string' ? legacyAssistantToolId(id) : id)
      : item
  ]));
}

function legacyCapabilityBoundary(system: string): string {
  const prefix = '<capability_boundary>\nApplication capability boundary (not a mandatory task plan):\n';
  const start = system.indexOf(prefix);
  if (start < 0) return system;
  const end = system.indexOf('\n</capability_boundary>', start + prefix.length);
  if (end < 0) return system;
  try {
    const before = system.slice(start + prefix.length, end);
    // Only the host-owned capability JSON is renamed. Free text stays byte-for-byte identical.
    const parsed: unknown = JSON.parse(before);
    return system.slice(0, start + prefix.length) + JSON.stringify(legacyToolLists(parsed)) + system.slice(end);
  } catch { return system; }
}
