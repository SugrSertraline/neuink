import { MineruSourceControls } from '@/modules/mineru/MineruSourceControls';
import { useMineruSource } from '@/modules/mineru/useMineruSource';
import { SettingsGroup } from './SettingsPrimitives';
import { Switch } from '@/components/ui/switch';

export function MineruSettingsSection({ active }: { active: boolean }) {
  const source = useMineruSource(active);
  return <SettingsGroup id="parser-mineru-local" title="MinerU 本地结果"
    description="配置 MinerU 结果目录；启用后自动检查并显示来源论文。关闭只隐藏 NeuInk 中的来源副本，不删除文件。">
    <div className="flex items-center justify-between gap-3 pb-2"><label htmlFor="mineru-source-enabled" className="text-sm">启用 MinerU 来源</label><Switch id="mineru-source-enabled" checked={source.settings?.enabled !== false} disabled={!source.settings || source.busy} onCheckedChange={enabled => void source.setEnabled(enabled)} /></div>
    <MineruSourceControls source={source} />
  </SettingsGroup>;
}
