import { MineruSourceControls } from '@/modules/mineru/MineruSourceControls';
import { useMineruSource } from '@/modules/mineru/useMineruSource';
import { SettingsGroup } from './SettingsPrimitives';

export function MineruSettingsSection({ active }: { active: boolean }) {
  const source = useMineruSource(active);
  return <SettingsGroup id="parser-mineru-local" title="MinerU 本地结果"
    description="查找本机已有的解析结果；在条目库中选择并导入论文。">
    <MineruSourceControls source={source} />
  </SettingsGroup>;
}
