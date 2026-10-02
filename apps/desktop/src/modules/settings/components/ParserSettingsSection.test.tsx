// @vitest-environment jsdom
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Tabs } from '@/components/ui/tabs';
import { GUIDE_MINERU_TUTORIAL_EVENT } from '@/modules/onboarding/progress';
import { PARSER_AUTO_PARSE_STORAGE_KEY } from '@/shared/lib/parserSettings';
import type { SettingsNavigationTarget } from '../settingsCatalog';
import { ParserSettingsSection } from './ParserSettingsSection';

const changed = vi.fn();
const openGuide = vi.fn();
function Harness({ target, configured = false }: { target?: SettingsNavigationTarget; configured?: boolean }) {
  const [endpoint, setEndpoint] = useState(configured ? 'http://localhost:18000' : '');
  const [apiKey, setApiKey] = useState(configured ? 'fixture-key' : '');
  return <Tabs value="parser"><ParserSettingsSection navigationTarget={target} props={{
    customParserEndpoint: endpoint, customParserApiKey: apiKey, effectiveParserEndpointLabel: endpoint || '未配置',
    onOpenMineruClientGuide: openGuide,
    onParserEndpointChange: value => { changed('endpoint', value); setEndpoint(value); },
    onParserApiKeyChange: value => { changed('key', value); setApiKey(value); },
  }} /></Tabs>;
}
beforeEach(() => { vi.clearAllMocks(); window.localStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('MinerU parsing method tabs', () => {
  it('defaults to client import even with a saved service, without changing its preferences', () => {
    window.localStorage.setItem(PARSER_AUTO_PARSE_STORAGE_KEY, '1');
    render(<Harness configured />);
    expect(screen.getByRole('tab', { name: 'MinerU 客户端（推荐）' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByRole('textbox', { name: 'MinerU URL' })).toBeNull();
    expect(screen.queryByRole('switch')).toBeNull();
    fireEvent.mouseDown(screen.getByRole('tab', { name: '自建 MinerU 服务' }), { button: 0 });
    expect((screen.getByRole('textbox', { name: 'MinerU URL' }) as HTMLInputElement).value).toBe('http://localhost:18000');
    expect(screen.getByRole('switch', { name: '导入 PDF 后自动解析' }).getAttribute('aria-checked')).toBe('true');
    expect(window.localStorage.getItem(PARSER_AUTO_PARSE_STORAGE_KEY)).toBe('1');
    expect(changed).not.toHaveBeenCalled();
  });

  it('retains service edits and the auto-parse choice when switching tabs', () => {
    render(<Harness />);
    fireEvent.mouseDown(screen.getByRole('tab', { name: '自建 MinerU 服务' }), { button: 0 });
    fireEvent.change(screen.getByRole('textbox', { name: 'MinerU URL' }), { target: { value: 'http://localhost:19000' } });
    fireEvent.change(screen.getByLabelText('服务 API Key'), { target: { value: 'new-fixture-key' } });
    fireEvent.click(screen.getByRole('switch', { name: '导入 PDF 后自动解析' }));
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'MinerU 客户端（推荐）' }), { button: 0 });
    fireEvent.mouseDown(screen.getByRole('tab', { name: '自建 MinerU 服务' }), { button: 0 });
    expect((screen.getByRole('textbox', { name: 'MinerU URL' }) as HTMLInputElement).value).toBe('http://localhost:19000');
    expect((screen.getByLabelText('服务 API Key') as HTMLInputElement).value).toBe('new-fixture-key');
    expect(screen.getByLabelText('服务 API Key').getAttribute('type')).toBe('password');
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it('keeps a failed preference write visible, then permits an explicit retry', () => {
    render(<Harness target={{ id: 'parser-auto', nonce: 1 }} />);
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => { throw new Error('storage unavailable'); });
    const toggle = screen.getByRole('switch', { name: '导入 PDF 后自动解析' });
    fireEvent.click(toggle);
    expect(screen.getByRole('alert').textContent).toContain('未能保存导入偏好');
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(window.localStorage.getItem(PARSER_AUTO_PARSE_STORAGE_KEY)).toBeNull();
    fireEvent.click(toggle);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(write).toHaveBeenCalledTimes(2);
  });

  it('opens the existing tutorial only on request and emits the onboarding event', () => {
    const onTutorial = vi.fn();
    window.addEventListener(GUIDE_MINERU_TUTORIAL_EVENT, onTutorial);
    try {
      render(<Harness />);
      expect(openGuide).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: '查看客户端导入图文教程' }));
      expect(openGuide).toHaveBeenCalledOnce();
      expect(onTutorial).toHaveBeenCalledOnce();
    } finally { window.removeEventListener(GUIDE_MINERU_TUTORIAL_EVENT, onTutorial); }
  });

  it('uses shared keyboard tab navigation without adding a scroll container', async () => {
    const view = render(<Harness />);
    const client = screen.getByRole('tab', { name: 'MinerU 客户端（推荐）' });
    act(() => client.focus());
    fireEvent.keyDown(client, { key: 'ArrowRight' });
    const service = screen.getByRole('tab', { name: '自建 MinerU 服务' });
    await waitFor(() => expect(service.getAttribute('aria-selected')).toBe('true'));
    expect(document.activeElement).toBe(service);
    fireEvent.keyDown(service, { key: 'Home' });
    await waitFor(() => expect(client.getAttribute('aria-selected')).toBe('true'));
    expect(document.activeElement).toBe(client);
    expect(view.container.querySelector('[class*="overflow"]')).toBeNull();
  });
});
