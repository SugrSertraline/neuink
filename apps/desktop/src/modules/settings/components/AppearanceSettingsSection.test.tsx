// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Tabs } from '@/components/ui/tabs';
import { AppearanceSettingsSection } from './AppearanceSettingsSection';
import type { SettingsPanelLayoutProps } from './SettingsPanelLayout';
import { APP_THEME_PRESETS } from '@/shared/lib/themePresets';

const material = vi.hoisted(() => ({ appearance: 'standard', setAppearance: vi.fn(), glassReducedTransparency: false, setGlassReducedTransparency: vi.fn() }));
vi.mock('@/shared/components/AppearanceProvider', () => ({ useAppearance: () => material }));
afterEach(() => { cleanup(); material.appearance = 'standard'; });
it('closes the accent picker and uses fixed colors for material themes without changing the saved standard accent', () => {
  const change = vi.fn();
  const props = { themePresets: APP_THEME_PRESETS, themePreset: 'violet', onThemePresetChange: change, uiScale: 1 } as unknown as SettingsPanelLayoutProps;
  const view = render(<Tabs value="appearance"><AppearanceSettingsSection props={props} /></Tabs>);
  fireEvent.click(screen.getByRole('button', { name: /^强调色：/ }));
  expect(screen.getByText('选择强调色')).toBeTruthy();
  for (const appearance of ['atelier', 'liquid-glass']) {
    material.appearance = appearance; view.rerender(<Tabs value="appearance"><AppearanceSettingsSection props={props} /></Tabs>);
    expect(screen.queryByRole('button', { name: /^强调色：/ })).toBeNull();
    expect(screen.queryByText('选择强调色')).toBeNull();
    expect(screen.getByText('主题预设配色')).toBeTruthy();
  }
  material.appearance = 'standard'; view.rerender(<Tabs value="appearance"><AppearanceSettingsSection props={props} /></Tabs>);
  expect(screen.getByRole('button', { name: /^强调色：/ }).textContent).toContain(APP_THEME_PRESETS.find(p => p.id === 'violet')!.label);
  expect(change).not.toHaveBeenCalled();
});
