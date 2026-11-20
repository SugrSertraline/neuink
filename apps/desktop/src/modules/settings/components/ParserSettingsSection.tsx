import { BookOpenText, Check } from 'lucide-react';
import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { GUIDE_MINERU_TUTORIAL_EVENT } from '@/modules/onboarding/progress';
import { cloudAccount } from '@/shared/ipc/cloudAccountApi';
import { persistAutoParseOnPdfImport, readAutoParseOnPdfImport } from '@/shared/lib/parserSettings';
import type { SettingsNavigationTarget } from '../settingsCatalog';
import type { SettingsPanelLayoutProps } from './SettingsPanelLayout';
import { SettingsPage, SettingSwitch } from './SettingsPrimitives';

type ParserProps = Pick<SettingsPanelLayoutProps,
  'customParserEndpoint' | 'customParserApiKey' | 'effectiveParserEndpointLabel'
  | 'onParserEndpointChange' | 'onParserApiKeyChange' | 'onOpenMineruClientGuide'>;

export function ParserSettingsSection({ props, navigationTarget, children }: {
  props: ParserProps;
  children?: ReactNode;
  navigationTarget?: SettingsNavigationTarget | null;
}) {
  // Search may reveal a panel without changing the selected parsing source.
  const [method, setMethod] = useState(() => props.customParserEndpoint === 'neuink-account' ? 'account' : 'service');
  const [accountMessage, setAccountMessage] = useState('');
  const [checkingAccount, setCheckingAccount] = useState(false);
  const [customDraft, setCustomDraft] = useState(() => window.localStorage.getItem('neuink.parser.customEndpoint') ?? '');
  useEffect(() => { setMethod(props.customParserEndpoint === 'neuink-account' ? 'account' : 'service'); }, [props.customParserEndpoint]);
  useLayoutEffect(() => {
    if (navigationTarget?.id === 'parser-service') setMethod('service');
    else if (navigationTarget?.id === 'parser-account') setMethod('account');
  }, [navigationTarget?.id, navigationTarget?.nonce]);

  const selectAccount = () => {
    if (checkingAccount) return;
    setCheckingAccount(true); setAccountMessage('');
    void cloudAccount<{available: boolean}>({action: 'parse_availability'}).then(result => {
      if (!result.available) { setAccountMessage('服务器尚未启用账号解析。'); return; }
      if (props.customParserEndpoint !== 'neuink-account') {
        window.localStorage.setItem('neuink.parser.customEndpoint', props.customParserEndpoint);
        setCustomDraft(props.customParserEndpoint);
      }
      props.onParserEndpointChange('neuink-account'); setMethod('account'); setAccountMessage('已选择账号解析服务。');
    }).catch(() => setAccountMessage('无法使用账号解析，请先连接服务器并登录。')).finally(() => setCheckingAccount(false));
  };

  return <SettingsPage tab="parser" title="导入与解析" description="从本地资料库导入论文，或配置 PDF 解析方式。">
    <section className="settings-group pt-0">
      <h3 className="text-sm font-semibold">解析设置</h3>
      <p className="text-xs leading-5 text-muted-foreground">当前使用：<span className="break-all font-medium text-foreground">{props.customParserEndpoint === 'neuink-account' ? 'NeuInk 账号解析' : props.effectiveParserEndpointLabel}</span></p>
      <AutoParseOnImportSetting />
    </section>
    <section className="settings-group grid gap-3 border-t border-border" aria-label="解析方式">
      <h3 className="text-sm font-semibold">选择解析方式</h3>
      <ToggleGroup type="single" size="sm" spacing={0} className="w-full max-w-md rounded-lg border border-border bg-muted/60 p-1" aria-label="解析方式" value={props.customParserEndpoint === 'neuink-account' ? 'account' : 'service'} onValueChange={value => {
        if (value === 'account') selectAccount();
        if (value === 'service') { setAccountMessage(''); setMethod('service'); if (props.customParserEndpoint === 'neuink-account') props.onParserEndpointChange(customDraft); }
      }}>
        <ToggleGroupItem className="h-9 min-w-0 flex-1 whitespace-normal text-muted-foreground data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-sm" value="account" disabled={checkingAccount}><Check aria-hidden className={props.customParserEndpoint === 'neuink-account' ? 'size-3.5' : 'invisible size-3.5'} />账号解析服务</ToggleGroupItem>
        <ToggleGroupItem className="h-9 min-w-0 flex-1 whitespace-normal text-muted-foreground data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-sm" value="service" disabled={checkingAccount}><Check aria-hidden className={props.customParserEndpoint !== 'neuink-account' ? 'size-3.5' : 'invisible size-3.5'} />自建 MinerU 服务</ToggleGroupItem>
      </ToggleGroup>
      {accountMessage && <p role={accountMessage.startsWith('已选择') ? 'status' : 'alert'} className={`rounded-md px-3 py-2 text-xs leading-5 ${accountMessage.startsWith('已选择') ? 'bg-accent text-accent-foreground' : 'bg-destructive/10 text-destructive'}`}>{accountMessage}</p>}
    </section>
    <div className="settings-group border-t border-border" hidden={method !== 'account'}>
        <section data-setting-id="parser-account" tabIndex={-1} className="grid gap-3">
          <h3 className="text-sm font-semibold">NeuInk 账号解析</h3>
          <p className="text-xs leading-5 text-muted-foreground">连接服务器并登录后，论文将上传到账号解析队列。解析状态显示在任务区。</p>
          <p className="text-xs text-muted-foreground">{props.customParserEndpoint === 'neuink-account' ? '已选择账号解析；状态和排队进度显示在任务区。' : '开启上方账号解析服务后使用。'}</p>
        </section>
    </div>
    <div className="settings-group border-t border-border" hidden={method !== 'service'}>
        <section data-setting-id="parser-service" tabIndex={-1} className="grid gap-3">
          <div>
            <h3 className="text-sm font-semibold">连接自己的 MinerU 服务</h3>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              配置服务 URL 和可选 API Key，上传 PDF 后由服务完成解析。API Key 会通过 <code>X-API-Key</code> 请求头发送。
            </p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="parser-endpoint">MinerU URL</Label>
            <Input id="parser-endpoint" placeholder="http://127.0.0.1:18000"
              value={props.customParserEndpoint === 'neuink-account' ? customDraft : props.customParserEndpoint} onChange={event => {
                if (props.customParserEndpoint === 'neuink-account') {
                  setCustomDraft(event.target.value);
                  window.localStorage.setItem('neuink.parser.customEndpoint', event.target.value);
                } else props.onParserEndpointChange(event.target.value);
              }} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="parser-api-key">服务 API Key</Label>
            <Input id="parser-api-key" placeholder="可选" type="password"
              value={props.customParserApiKey} onChange={event => props.onParserApiKeyChange(event.target.value)} />
          </div>
          <p className="text-xs leading-5 text-muted-foreground">服务可返回 MinerU 兼容 JSON，或包含 content_list JSON 及正文图片的 ZIP。</p>
        </section>
    </div>
    {children && <section className="settings-group border-t border-border"><h3 className="text-sm font-semibold">导入来源</h3>{children}</section>}
        <section data-setting-id="parser-zip" tabIndex={-1} className="settings-group grid gap-3 border-t border-border">
          <h3 className="text-sm font-semibold">导入 MinerU 客户端结果</h3>
          <p className="text-xs leading-5 text-muted-foreground">
            在 MinerU 客户端解析 PDF 后，可直接导入完整结果目录，或导入 ZIP／RAR 压缩包。无需配置解析服务 URL 或 API Key。
          </p>
          <div className="text-xs leading-5 text-muted-foreground">
            <p>结果需包含 <code>content_list_v2.json</code> 或兼容的 <code>content_list.json</code>，以及正文引用的图片。</p>
            <ul className="mt-2 list-disc space-y-1 pl-4">
              <li>创建新条目：结果中还需包含原 PDF。</li>
              <li>导入已有 PDF 条目：无需重复附带 PDF。</li>
            </ul>
          </div>
          <div>
            <Button size="sm" type="button" variant="outline" onClick={() => {
              props.onOpenMineruClientGuide();
              window.dispatchEvent(new Event(GUIDE_MINERU_TUTORIAL_EVENT));
            }}>
              <BookOpenText aria-hidden="true" />查看客户端导入图文教程
            </Button>
          </div>
        </section>

  </SettingsPage>;
}

export function AutoParseOnImportSetting({ id = "parser-auto" }: { id?: string }) {
  const [enabled, setEnabled] = useState(readAutoParseOnPdfImport);
  const [error, setError] = useState(false);
  useEffect(() => { const refresh = () => setEnabled(readAutoParseOnPdfImport()); window.addEventListener("neuink-parser-auto-changed", refresh); window.addEventListener("storage", refresh); return () => { window.removeEventListener("neuink-parser-auto-changed", refresh); window.removeEventListener("storage", refresh); }; }, []);
  return <>
    <SettingSwitch id={id} label="导入 PDF 后自动解析" description="默认关闭。开启后使用当前选择的账号或自建服务；导入已有解析结果无需开启。" checked={enabled} onCheckedChange={checked => {
      try { persistAutoParseOnPdfImport(checked); setEnabled(checked); setError(false); }
      catch { setError(true); }
    }} />
    {error && <p role="alert" className="text-xs text-destructive">未能保存导入偏好，请重新操作以重试。</p>}
  </>;
}
