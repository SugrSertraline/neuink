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

  return <SettingsGroup id="tools-local-agent" title="本地 Agent">
    <SettingSwitch label="启用本地 Agent" description="自动查找本机已安装的 Claude Code、Codex 和 OpenCode。"
      checked={enabled} onCheckedChange={updateEnabled} />
    {saveError && <p role="alert" className="mt-2 text-xs text-destructive">{saveError}</p>}
    {enabled && <>
      {LOCAL_AGENTS.map(agent => { const result=results[agent.id]; return <div key={agent.id} className="border-t border-border py-3">
        <div className="min-w-0"><p className="text-sm font-medium">{agent.name}</p>
          <p role={result?.status === 'error' ? 'alert' : 'status'} className={`mt-1 text-xs ${result?.status === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>
            {result?.message ?? (busy ? '正在检测…' : '等待检测')}
          </p>
          <LocalAgentConnectionTest provider={agent.id} available={active && !busy && result?.status === 'detected'} />
        </div>
      </div>; })}
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={retry}>重新检测</Button>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">检测仅确认已安装。测试连接会使用本机模型发送固定示例并验证工具调用，可能消耗少量额度，不发送资料库内容。测试通过后可在对话顶部选择本地 Agent；实际任务仍以运行结果为准。</p>
    </>}
    <LocalAgentPermissionSettings key={workspaceRoot} root={workspaceRoot} />
  </SettingsGroup>;
}
