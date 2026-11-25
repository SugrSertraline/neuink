import { ZoteroSourceControls } from '@/modules/zotero/ZoteroSourceControls';
import { useZoteroSource } from '@/modules/zotero/useZoteroSource';
import { SettingsGroup } from './SettingsPrimitives';
import { Switch } from '@/components/ui/switch';

export function ZoteroSettingsSection({ active }: { workspaceRoot: string | null; active: boolean }) {
  const source = useZoteroSource(active);
  return <SettingsGroup id="parser-zotero" title="Zotero 本地资料" description="配置 Zotero 数据目录；启用后自动检查并显示来源论文。关闭只隐藏 NeuInk 中的来源副本，不删除文件。">
    <div className="flex items-center justify-between gap-3 pb-2"><label htmlFor="zotero-source-enabled" className="text-sm">启用 Zotero 来源</label><Switch id="zotero-source-enabled" checked={source.settings?.enabled !== false} disabled={!source.settings || source.busy} onCheckedChange={enabled => void source.setEnabled(enabled)} /></div>
    <ZoteroSourceControls source={source} />
  </SettingsGroup>;
}
