// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Tabs } from '@/components/ui/tabs';
import { cloudAccount } from '@/shared/ipc/cloudAccountApi';
import { ParserSettingsSection, AutoParseOnImportSetting } from './ParserSettingsSection';
vi.mock('@/shared/ipc/cloudAccountApi', () => ({ cloudAccount: vi.fn() }));
function Harness() {
  const [endpoint, setEndpoint] = useState('http://localhost:18000');
  const [key, setKey] = useState('');
  return <Tabs value="parser"><ParserSettingsSection props={{ customParserEndpoint:endpoint, customParserApiKey:key,
    effectiveParserEndpointLabel:endpoint || '未配置', onParserEndpointChange:setEndpoint, onParserApiKeyChange:setKey,
    onOpenMineruClientGuide:vi.fn() }}><div>来源项目</div></ParserSettingsSection><AutoParseOnImportSetting id="reader-auto-parse" /></Tabs>;
}
beforeEach(() => { window.localStorage.clear(); vi.clearAllMocks(); });
afterEach(cleanup);
it('selects exactly one service, preserving the self-hosted address', async () => {
  vi.mocked(cloudAccount).mockResolvedValueOnce({available:false}).mockResolvedValueOnce({available:true});
  render(<Harness />);
  fireEvent.click(screen.getByRole('radio',{name:'账号解析服务'}));
  await screen.findByRole('alert');
  expect(screen.getByRole('radio',{name:'自建 MinerU 服务'}).getAttribute('aria-checked')).toBe('true');
  fireEvent.click(screen.getByRole('radio',{name:'账号解析服务'}));
  await waitFor(() => expect(screen.getByRole('radio',{name:'账号解析服务'}).getAttribute('aria-checked')).toBe('true'));
  fireEvent.click(screen.getByRole('radio',{name:'自建 MinerU 服务'}));
  expect((screen.getByRole('textbox',{name:'MinerU URL'}) as HTMLInputElement).value).toBe('http://localhost:18000');
  expect(screen.getByRole('radio',{name:'账号解析服务'}).getAttribute('aria-checked')).toBe('false');
});
it('keeps both auto-parse controls synchronized without remounting', () => {
  render(<Harness />);
  const controls=screen.getAllByRole('switch',{name:'导入 PDF 后自动解析'});
  fireEvent.click(controls[0]);
  expect(controls.map(x => x.getAttribute('aria-checked'))).toEqual(['true','true']);
  fireEvent.click(controls[1]);
  expect(controls.map(x => x.getAttribute('aria-checked'))).toEqual(['false','false']);
});
it('places import sources after service selection and keeps client instructions visible', () => {
  render(<Harness />);
  const selection=screen.getByRole('region',{name:'解析方式'});
  const source=screen.getByText('来源项目');
  expect(selection.compareDocumentPosition(source) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByText('导入 MinerU 客户端结果')).toBeTruthy();
});
