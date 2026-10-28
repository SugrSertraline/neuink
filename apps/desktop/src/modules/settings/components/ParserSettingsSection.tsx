import { BookOpenText } from 'lucide-react';
import { useLayoutEffect, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { GUIDE_MINERU_TUTORIAL_EVENT } from '@/modules/onboarding/progress';
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
  // This is presentation state only; switching methods does not change parsing preferences.
  const [method, setMethod] = useState('client');
  useLayoutEffect(() => {
    if (navigationTarget?.id === 'parser-zip') setMethod('client');
    else if (navigationTarget?.id === 'parser-service' || navigationTarget?.id === 'parser-auto') setMethod('service');
  }, [navigationTarget?.id, navigationTarget?.nonce]);

  return <SettingsPage tab="parser" title="导入与解析" description="从本地资料库导入论文，或配置 PDF 解析方式。">
    {children}
    <Tabs value={method} onValueChange={setMethod} className="min-w-0 gap-4">
      <TabsList aria-label="MinerU 解析方式" className="w-full data-[orientation=horizontal]:h-auto">
        <TabsTrigger value="client" className="h-auto min-w-0 whitespace-normal px-3 py-1.5 text-xs">MinerU 客户端（推荐）</TabsTrigger>
        <TabsTrigger value="service" className="h-auto min-w-0 whitespace-normal px-3 py-1.5 text-xs">自建 MinerU 服务</TabsTrigger>
      </TabsList>
      <TabsContent forceMount value="client" hidden={method !== 'client'} className="min-w-0">
        <section data-setting-id="parser-zip" tabIndex={-1} className="grid gap-3">
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
      </TabsContent>
      <TabsContent forceMount value="service" hidden={method !== 'service'} className="min-w-0">
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
              value={props.customParserEndpoint} onChange={event => props.onParserEndpointChange(event.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="parser-api-key">服务 API Key</Label>
            <Input id="parser-api-key" placeholder="可选" type="password"
              value={props.customParserApiKey} onChange={event => props.onParserApiKeyChange(event.target.value)} />
          </div>
          <AutoParseOnImportSetting />
          <p className="text-xs leading-5 text-muted-foreground">服务可返回 MinerU 兼容 JSON，或包含 content_list JSON 及正文图片的 ZIP。</p>
          <p className="rounded-md border bg-muted px-3 py-2 text-xs leading-5 text-muted-foreground">
            当前解析请求地址：<span className="ml-1 break-all font-mono text-[11px]">{props.effectiveParserEndpointLabel}</span>
          </p>
        </section>
      </TabsContent>
    </Tabs>
  </SettingsPage>;
}

function AutoParseOnImportSetting() {
  const [enabled, setEnabled] = useState(readAutoParseOnPdfImport);
  const [error, setError] = useState(false);
  return <>
    <SettingSwitch id="parser-auto" label="导入 PDF 后自动解析" description="默认关闭。开启后会使用已配置的 MinerU 服务；客户端 ZIP 导入无需开启。" checked={enabled} onCheckedChange={checked => {
      try { persistAutoParseOnPdfImport(checked); setEnabled(checked); setError(false); }
      catch { setError(true); }
    }} />
    {error && <p role="alert" className="text-xs text-destructive">未能保存导入偏好，请重新操作以重试。</p>}
  </>;
}
