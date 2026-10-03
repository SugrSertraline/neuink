import { setAssistantDebug, useAssistantDebug } from '@/shared/lib/assistantDebug';
import { SettingsGroup, SettingSwitch } from './SettingsPrimitives';

export function AssistantDebugSetting() {
  const enabled = useAssistantDebug();
  return <SettingsGroup title="诊断">
    <SettingSwitch id="tools-assistant-debug" label="助手调试信息" checked={enabled} onCheckedChange={setAssistantDebug}
      description="默认关闭。仅本机显示错误类别和状态码，不显示密钥、认证头、隐私路径或远端原始正文；不改变助手执行与权限。" />
  </SettingsGroup>;
}
