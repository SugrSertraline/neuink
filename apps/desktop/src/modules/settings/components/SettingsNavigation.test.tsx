// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SettingsNavigationTarget, SettingsTab } from '../settingsCatalog';
import { useSettingsNavigation } from './SettingsNavigation';

function Harness({ target }: { target: SettingsNavigationTarget }) {
  const [tab, setTab] = useState<SettingsTab>('models');
  const navigation = useSettingsNavigation(tab, setTab, target);
  return <main ref={navigation.rootRef} className="settings-panel-shell"><div className="settings-viewport">
    <div data-setting-id="models-assistant" tabIndex={-1}><input aria-label="助手模型" /></div>
  </div></main>;
}
beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (callback:FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
  vi.stubGlobal('cancelAnimationFrame', window.clearTimeout.bind(window));
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(this:HTMLElement) {
    return this.classList.contains('settings-viewport')
      ? { top:100, height:500 } as DOMRect : { top:350, height:100 } as DOMRect;
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('settings navigation highlight clearance', () => {
  it('leaves 24px above the target at 125% zoom, without changing its layout or input focus contract', async () => {
    const view = render(<Harness target={{ id:'models-assistant', nonce:1 }} />);
    const target = view.container.querySelector<HTMLElement>('[data-setting-id]')!;
    await waitFor(() => expect(target.dataset.settingHighlight).toBe('true'));
    expect(view.container.querySelector('.settings-viewport')?.scrollTop).toBe(176);
    expect(document.activeElement).toBe(target.querySelector('input'));
    expect(target.style.padding).toBe('');
    view.unmount();
    expect(target.dataset.settingHighlight).toBeUndefined();
  });
  it('uses the CSS scroll clearance on repeat navigation and cancels the previous highlight timer', async () => {
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({ scrollMarginTop:'32px' } as CSSStyleDeclaration);
    const view = render(<Harness target={{ id:'models-assistant', nonce:1 }} />);
    const target = view.container.querySelector<HTMLElement>('[data-setting-id]')!;
    await waitFor(() => expect(target.dataset.settingHighlight).toBe('true'));
    expect(view.container.querySelector('.settings-viewport')?.scrollTop).toBe(168);
    view.rerender(<Harness target={{ id:'models-assistant', nonce:2 }} />);
    await waitFor(() => expect(view.container.querySelector('.settings-viewport')?.scrollTop).toBe(336));
    expect(target.dataset.settingHighlight).toBe('true');
  });
});
