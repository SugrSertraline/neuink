import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useAppearance, type AppAppearance } from '@/shared/components/AppearanceProvider';
import { normalizeUiScale, UI_SCALE_OPTIONS } from '@/shared/lib/uiScale';
import type { AppThemePresetId } from '@/shared/lib/themePresets';
import type { SettingsPanelLayoutProps } from './SettingsPanelLayout';
import { SettingsPage, SettingsGroup, SettingSelect, SettingSwitch } from './SettingsPrimitives';

export function AppearanceSettingsSection({ props }: { props: SettingsPanelLayoutProps }) {
  const { appearance, setAppearance, glassReducedTransparency, setGlassReducedTransparency } = useAppearance();
  const [failedSave, setFailedSave] = useState<null | (() => boolean)>(null);
  const persist = (save: () => boolean) => {
    try { setFailedSave(save() ? null : () => save); }
    catch { setFailedSave(() => save); }
  };
  return <SettingsPage tab="appearance" title="外观与界面" description="本机偏好 · 修改即时生效。搜索 theme 也可打开风格菜单。">
    <SettingsGroup title="风格与配色">
      <SettingSelect id="appearance-style" label="界面风格" description="设置、导航、菜单和弹窗共用相同风格。" value={appearance}
        options={[{ value: 'standard', label: '标准' }, { value: 'atelier', label: '拟物' }, { value: 'liquid-glass', label: '玻璃' }]}
        onValueChange={value => persist(() => setAppearance(value as AppAppearance))} />
      <SettingSelect id="appearance-color" label="强调色" description={appearance === 'standard' ? '用于选中、焦点和主要操作。' : '配色偏好会保留；当前材质使用自身的语义配色。'}
        value={props.themePreset} options={props.themePresets.map(preset => ({ value: preset.id, label: preset.label }))}
        onValueChange={value => persist(() => { props.onThemePresetChange(value as AppThemePresetId); return true; })} />
      <SettingSwitch id="appearance-transparency" label="降低透明度" description={appearance === 'liquid-glass' ? (glassReducedTransparency ? '当前为实色显示。关闭此项可恢复半透明、模糊与折射。' : '开启后改用实色显示，关闭半透明、模糊与折射。') : '仅用于玻璃风格，当前选择会保留。'}
        disabled={appearance !== 'liquid-glass'} checked={glassReducedTransparency} onCheckedChange={value => persist(() => setGlassReducedTransparency(value))} />
      {failedSave && <div role="alert" className="mt-2 text-xs text-destructive">未能保存外观设置，请重试。
        <Button size="xs" variant="outline" onClick={() => persist(failedSave)}>重试保存</Button></div>}
    </SettingsGroup>
    <SettingsGroup title="界面大小">
      <SettingSelect id="appearance-scale" label="界面缩放" description="Ctrl/Cmd + 加减号调整，Ctrl/Cmd + 0 恢复 100%。" value={String(props.uiScale)}
        options={UI_SCALE_OPTIONS.map(scale => ({ value: String(scale), label: `${Math.round(scale * 100)}%${scale === 1 ? '（默认）' : ''}` }))}
        onValueChange={value => persist(() => { props.onUiScaleChange(normalizeUiScale(value)); return true; })} />
    </SettingsGroup>
  </SettingsPage>;
}
