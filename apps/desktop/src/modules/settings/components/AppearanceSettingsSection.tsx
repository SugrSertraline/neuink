import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useAppearance, type AppAppearance } from '@/shared/components/AppearanceProvider';
import { normalizeUiScale, UI_SCALE_OPTIONS } from '@/shared/lib/uiScale';
import type { SettingsPanelLayoutProps } from './SettingsPanelLayout';
import { SettingsPage, SettingsGroup, SettingRow, SettingSelect, SettingSwitch } from './SettingsPrimitives';

export function AppearanceSettingsSection({ props }: { props: SettingsPanelLayoutProps }) {
  const { appearance, setAppearance, glassReducedTransparency, setGlassReducedTransparency } = useAppearance();
  const [failedSave, setFailedSave] = useState<null | (() => boolean)>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  useEffect(() => { setPaletteOpen(false); }, [appearance]);
  const selectedColor = props.themePresets.find(preset => preset.id === props.themePreset);
  const persist = (save: () => boolean) => {
    try { setFailedSave(save() ? null : () => save); }
    catch { setFailedSave(() => save); }
  };
  return <SettingsPage tab="appearance" title="外观与界面" description="本机偏好 · 修改即时生效。搜索 theme 也可打开风格菜单。">
    <SettingsGroup title="风格与配色">
      <SettingSelect id="appearance-style" label="界面风格" description="设置、导航、菜单和弹窗共用相同风格。" value={appearance}
        options={[{ value: 'standard', label: '标准' }, { value: 'atelier', label: '拟物' }, { value: 'liquid-glass', label: '玻璃' }]}
        onValueChange={value => persist(() => setAppearance(value as AppAppearance))} />
      <SettingRow id="appearance-color" label="强调色" description={appearance === 'standard' ? '用于选中、焦点和主要操作。' : '当前主题使用固定配色，切回标准主题后恢复原强调色。'}>
        {appearance === 'standard' ? <Popover open={paletteOpen} onOpenChange={setPaletteOpen}>
          <PopoverTrigger asChild><Button size="sm" variant="outline" aria-label={`强调色：${selectedColor?.label ?? ''}`}>
            <span aria-hidden="true" className="size-4 rounded-full border border-border" style={{ backgroundColor: selectedColor?.swatch }} />
            {selectedColor?.label}
          </Button></PopoverTrigger>
          <PopoverContent align="end" className="w-64 p-3" aria-label="强调色色板">
            <p className="mb-2 text-xs font-medium">选择强调色</p>
            <div className="grid grid-cols-3 gap-1">
              {props.themePresets.map(preset => <Button key={preset.id} variant={props.themePreset === preset.id ? 'secondary' : 'ghost'}
                aria-label={preset.label} aria-pressed={props.themePreset === preset.id} className="h-auto flex-col gap-1.5 py-2 text-xs"
                onClick={() => { persist(() => { props.onThemePresetChange(preset.id); return true; }); setPaletteOpen(false); }}>
                <span aria-hidden="true" className="size-7 rounded-full border border-border" style={{ backgroundColor: preset.swatch }} />
                {preset.label}
              </Button>)}
            </div>
          </PopoverContent>
        </Popover> : <span className="text-sm text-muted-foreground">主题预设配色</span>}
      </SettingRow>
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
