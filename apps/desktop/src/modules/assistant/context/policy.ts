/** A session's stable application policy. Dynamic targets and limits belong in appended messages. */
export const CONTEXT_POLICY_VERSION = 2;

export function composeSystemPolicy(base: string, agentProfile = ''): string {
  return [base.trim(), agentProfile.trim()].filter(Boolean).join('\n\n');
}
