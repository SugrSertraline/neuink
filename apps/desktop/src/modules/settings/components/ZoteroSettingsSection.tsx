import { ZoteroSourceControls } from '@/modules/zotero/ZoteroSourceControls';
import { useZoteroSource } from '@/modules/zotero/useZoteroSource';
import { SettingsGroup } from './SettingsPrimitives';

export function ZoteroSettingsSection({ active }: { workspaceRoot: string | null; active: boolean }) {
  const source = useZoteroSource(active);
  return <SettingsGroup id="parser-zotero" title="Zotero 本地资料" description="配置本机 Zotero 数据目录；在条目库中选择并导入文献。">
    <ZoteroSourceControls source={source} />
  </SettingsGroup>;
}
