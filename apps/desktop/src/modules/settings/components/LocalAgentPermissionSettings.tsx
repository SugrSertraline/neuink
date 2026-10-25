import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { localAgentName } from '@/shared/lib/localAgentSettings';
import { localAgentPermissionLabel, revokeLocalAgentPermission, useLocalAgentPermissions, type LocalAgentPermission } from '@/shared/lib/localAgentPermissions';

/** Grants own their persisted state. The settings page owns scrolling; buttons use native focus/keyboard behavior. */
export function LocalAgentPermissionSettings({ root }: { root?: string | null }) {
  const { grants, error } = useLocalAgentPermissions(root);
  const [saveError, setSaveError] = useState('');
  const revoke = (permission?: LocalAgentPermission) => {
    if (!root) return;
    try { revokeLocalAgentPermission(root, permission); setSaveError(''); }
    catch { setSaveError('撤销失败，原授权仍然有效。请重试。'); }
  };
  return <div className="mt-3 border-t border-border pt-3" aria-label="本地操作授权">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h4 className="text-sm font-medium">本地操作授权</h4>
      {grants.length > 0 && <Button type="button" size="xs" variant="outline" onClick={() => revoke()}>全部恢复询问</Button>}
    </div>
    <p className="mt-1 text-xs leading-5 text-muted-foreground">仅适用于本机、当前资料库及对应 Agent。撤销后，下次操作会重新询问；已开始的操作不会因此停止。</p>
    {!root ? <p className="mt-2 text-xs text-muted-foreground">打开资料库后可管理授权。</p>
      : error ? <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>
        : grants.length === 0 ? <p className="mt-2 text-xs text-muted-foreground">尚未设置“以后都允许”。本地操作需要确认时，可在对话中选择。</p>
          : <ul className="mt-2 divide-y divide-border">
            {grants.map(grant => <li key={`${grant.provider}.${grant.toolName}`} className="flex min-w-0 items-center justify-between gap-2 py-2">
              <div className="min-w-0 text-xs">
                <p className="break-words [overflow-wrap:anywhere]">{localAgentName(grant.provider)} · {localAgentPermissionLabel(grant.toolName)}</p>
                <p className="mt-0.5 text-muted-foreground">以后都允许</p>
              </div>
              <Button type="button" size="xs" variant="outline" className="shrink-0"
                aria-label={`撤销 ${localAgentName(grant.provider)} 的${localAgentPermissionLabel(grant.toolName)}授权`}
                onClick={() => revoke(grant)}>撤销授权</Button>
            </li>)}
          </ul>}
    {saveError && <p role="alert" className="mt-2 text-xs text-destructive">{saveError}</p>}
  </div>;
}
