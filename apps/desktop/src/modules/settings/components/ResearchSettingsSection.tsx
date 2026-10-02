import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getResearchSettings, saveResearchSettings, type ResearchSettings } from '@/shared/ipc/researchApi';
import { registerSegmentEditorCloseHandler, setSegmentEditorDirty } from '@/modules/reader/components/segmentEditorDirtyRegistry';
import { SettingsDisclosure, SettingsGroup, SettingSwitch } from './SettingsPrimitives';

/** Settings owns draft/status; settings-viewport owns scrolling. No new drag or key interception. */
export function ResearchSettingsSection({ active, children }: { active: boolean; children?: ReactNode }) {
  const owner = useId();
  const [settings, setSettings] = useState<ResearchSettings | null>(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const mounted = useRef(true);
  const pending = useRef(false);
  const latest = useRef({ key, busy });
  latest.current = { key, busy };
  useEffect(() => {
    mounted.current = true;
    const unregister = registerSegmentEditorCloseHandler('settings', owner, {
      isDirty: () => Boolean(latest.current.key || pending.current),
      save: async () => {
        if (!latest.current.key && !pending.current) return true;
        setError('请先保存或放弃检索密钥，再关闭设置。');
        return false;
      },
      discard: () => { setKey(''); latest.current.key = ''; }
    });
    return () => { mounted.current = false; unregister(); setSegmentEditorDirty('settings', owner, false); };
  }, [owner]);
  useEffect(() => { setSegmentEditorDirty('settings', owner, Boolean(key || (busy && settings))); }, [owner, key, busy, settings]);
  useEffect(() => {
    if (!active || settings) return;
    let cancelled = false;
    setBusy(true); setError('');
    void getResearchSettings().then(value => { if (!cancelled) setSettings(value); })
      .catch(caught => { if (!cancelled) setError(String(caught)); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [active, attempt]);
  const save = async (change: Partial<ResearchSettings>, webKey?: string) => {
    if (!settings || pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try {
      const next = await saveResearchSettings({ papers_enabled: change.papers_enabled ?? settings.papers_enabled,
        web_enabled: change.web_enabled ?? settings.web_enabled,
        use_tavily: change.use_tavily ?? settings.use_tavily, ...(webKey ? { web_key: webKey } : {}) });
      if (mounted.current) { setSettings(next); if (webKey) { setKey(''); latest.current.key = ''; } }
    } catch (caught) { if (mounted.current) setError(String(caught)); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  };
  return <><SettingsGroup id="tools-research" title="基础检索" description="默认使用免费服务，无需密钥。下载 PDF 前仍需确认。">
    {!settings ? <div className="grid gap-2 text-sm">
      {busy ? <p role="status">正在读取检索设置…</p> : <Button variant="outline" size="sm" onClick={() => setAttempt(n => n + 1)}>重新读取检索设置</Button>}
    </div> : <div>
      <SettingSwitch label="论文检索与 PDF 导入" checked={settings.papers_enabled} disabled={busy}
        description="搜索 arXiv、Crossref 等来源，整理资料并导入公开 PDF。"
        onCheckedChange={value => void save({ papers_enabled: value })} />
      <SettingSwitch label="网页搜索与正文提取" checked={settings.web_enabled} disabled={busy}
        description={settings.use_tavily ? '当前使用 Tavily 搜索，并读取公开网页正文。' : '使用 DuckDuckGo / Bing 搜索，并读取公开网页正文。'}
        onCheckedChange={value => void save({ web_enabled: value })} />
    </div>}
    {busy && settings && !key && <p role="status" className="mt-2 text-xs text-muted-foreground">保存中…</p>}
    {error && !key && <p role="alert" className="mt-2 text-sm text-destructive [overflow-wrap:anywhere]">{error}</p>}
    <p className="mt-2 text-xs leading-5 text-muted-foreground">检索会发送关键词或目标网址，不上传本地 PDF；请勿输入敏感内容。</p>
  </SettingsGroup>
  <SettingsGroup title="可选服务" description="不配置也能使用免费检索。保存密钥不会自动启用服务。">
      <SettingsDisclosure title="Tavily" description="替代免费网页搜索，需独立密钥，可能产生费用。"
        status={key ? '未保存' : busy ? (settings ? '保存中…' : '读取中…') : !settings ? '未就绪' : settings.use_tavily ? '已启用' : settings.has_web_key ? '未启用' : '未配置'}>
        {settings ? <>
        <div className="mt-3 grid min-w-0 gap-2">
        <SettingSwitch label="使用 Tavily 替代免费网页服务" checked={settings.use_tavily} disabled={busy || (!settings.has_web_key && !settings.use_tavily)}
          description={settings.has_web_key ? '仅手动开启后使用，可能产生服务费用。保存密钥不会自动开启；关闭后恢复免密钥方式。' : '需先保存独立检索密钥才能开启。若原凭据已不可用，可以关闭此项恢复免费服务。'}
          onCheckedChange={value => void save({ use_tavily: value })} />
        <Label htmlFor={`${owner}-key`}>Tavily API Key{settings.has_web_key ? '（已配置）' : '（未配置）'}</Label>
        <Input id={`${owner}-key`} type="password" autoComplete="off" spellCheck={false} value={key} maxLength={4096}
          disabled={busy} placeholder={settings.has_web_key ? '输入新密钥可替换现有凭据' : '输入检索服务密钥'} onChange={event => setKey(event.target.value)} />
        <p className="text-xs text-muted-foreground">凭据只保存到系统凭据库，不回显、不写入对话或资料库。新配置在下一次助手请求中生效。</p>
        {key && <div className="flex flex-wrap justify-end gap-2">
          <span role="status" className="mr-auto text-xs text-muted-foreground">{busy ? '保存中…' : '未保存'}</span>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setKey('')}>放弃输入</Button>
          <Button size="sm" disabled={busy || !key.trim()} onClick={() => void save({}, key.trim())}>保存密钥</Button>
        </div>}
        {error && key && <p role="alert" className="text-sm text-destructive [overflow-wrap:anywhere]">{error}</p>}
        </div>
        </> : <p className="text-xs text-muted-foreground">检索设置尚未就绪，请在上方重试。</p>}
      </SettingsDisclosure>
      {children}
  </SettingsGroup></>;
}
