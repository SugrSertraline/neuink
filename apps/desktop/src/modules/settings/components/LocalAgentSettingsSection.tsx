import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { SettingsGroup, SettingSwitch } from './SettingsPrimitives';
import { LOCAL_AGENTS, setLocalAgentEnabled, useLocalAgentEnabled } from '@/shared/lib/localAgentSettings';
import { useLocalAgentDetections } from '@/shared/lib/useLocalAgentDetections';
import { LocalAgentConnectionTest } from './LocalAgentConnectionTest';
import { LocalAgentPermissionSettings } from './LocalAgentPermissionSettings';

/** Local preference owns opt-in; settings-viewport owns scrolling. No extra keyboard/drag contract. */
export function LocalAgentSettingsSection({ active, workspaceRoot }: { active: boolean; workspaceRoot?: string | null }) {
  const enabled = useLocalAgentEnabled();
  const {results,busy,retry} = useLocalAgentDetections(active && enabled);
  const [saveError, setSaveError] = useState('');

  const updateEnabled = (value: boolean) => {
    try {
      setLocalAgentEnabled(value);
      setSaveError('');
    } catch { setSaveError('设置保存失败，请重试。'); }
  };

  return <SettingsGroup id="tools-local-agent" title="本地 Agent" action={
    <Button type="button" size="xs" variant="ghost" disabled={!enabled || busy} onClick={retry}>{busy ? '检测中…' : '重新检测'}</Button>
  }>
    <SettingSwitch label="启用本地 Agent"
      checked={enabled} onCheckedChange={updateEnabled} />
    {saveError && <p role="alert" className="mt-2 text-xs text-destructive">{saveError}</p>}
    <div className="settings-local-agents">
      {LOCAL_AGENTS.map(agent => { const result=results[agent.id]; return <div key={agent.id} className="min-w-0 rounded-md border border-border bg-muted/20 p-3">
        <div className="min-w-0"><p className="text-sm font-medium">{agent.name}</p>
          <p role={result?.status === 'error' ? 'alert' : 'status'} className={`mt-1 text-xs ${result?.status === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>
            {!enabled ? '未启用' : result?.message ?? (busy ? '正在检测…' : '等待检测')}
          </p>
          {enabled && <LocalAgentConnectionTest provider={agent.id} available={active && !busy && result?.status === 'detected'} />}
        </div>
      </div>; })}
    </div>
    <LocalAgentPermissionSettings key={workspaceRoot} root={workspaceRoot} />
  </SettingsGroup>;
}
