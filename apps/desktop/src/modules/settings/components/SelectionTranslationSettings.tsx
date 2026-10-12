import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { WorkspaceWebLink } from '@/shared/components/WorkspaceWebLink';
import { getSelectionTranslationSettings, saveSelectionTranslationSettings, testSelectionTranslationService,
  type SelectionTranslationSettings as Settings, type SelectionTranslationProvider as Provider } from '@/shared/ipc/selectionTranslationApi';
import { registerSegmentEditorCloseHandler, setSegmentEditorDirty } from '@/modules/reader/components/segmentEditorDirtyRegistry';
import { SettingsGroup, SettingSelect } from './SettingsPrimitives';

const presets: Record<Provider, { label: string; endpoint: string; model: string; help: string; links?: { label: string; url: string }[] }> = {
  reading_model: { label: '沿用整体翻译模型', endpoint: '', model: '', help: '选中文字翻译将使用下方的整体翻译模型；更改该模型也会影响选中文字翻译。如需独立配置，请选择其他服务。' },
  azure: { label: 'Microsoft Azure Translator', endpoint: 'https://api.cognitive.microsofttranslator.com/translate', model: '',
    help: '需自行申请 Translator 密钥。F0 免费层每月 200 万字符；付费层按量计费。请选择适合的套餐，额度和地区以官网为准。', links: [
      { label: '官网与价格', url: 'https://azure.microsoft.com/pricing/details/translator/' },
      { label: '控制台 / 申请密钥', url: 'https://portal.azure.com/' },
    ] },
  deepl: { label: 'DeepL API', endpoint: 'https://api-free.deepl.com/v2/translate', model: '',
    help: '需 DeepL API 密钥。Developer 免费试用共 100 万字符，不按月重置；用完需升级付费套餐。旧 API Free 每月 50 万字符，已不开放新购。请求地址请按账户套餐及接入文档填写，地区与额度以官网为准。', links: [
      { label: '官网与套餐', url: 'https://www.deepl.com/pro' },
      { label: '获取 API 密钥', url: 'https://www.deepl.com/your-account/keys' },
      { label: '免费额度说明', url: 'https://support.deepl.com/hc/en-us/articles/360021200939-DeepL-API-plans' },
      { label: '接入文档', url: 'https://developers.deepl.com/docs/getting-started/auth' },
    ] },
  qwen_mt: { label: '通义 Qwen-MT 翻译模型', endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', model: 'qwen-mt-flash',
    help: '默认北京地域地址，密钥和地域须匹配。支持 qwen-mt-flash / lite / plus；按量计费，试用额度不代表永久免费。', links: [
      { label: '官网控制台 / 申请密钥', url: 'https://bailian.console.aliyun.com/' },
      { label: '价格与免费额度', url: 'https://help.aliyun.com/zh/model-studio/model-pricing' },
      { label: '接入文档', url: 'https://help.aliyun.com/zh/model-studio/machine-translation' },
    ] },
};

/** This component owns the draft; settings-viewport owns scrolling. Native controls retain keyboard behavior. */
export function SelectionTranslationSettings({ active, children }: { active: boolean; children?: ReactNode }) {
  const owner = useId();
  const [saved, setSaved] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [testResult, setTestResult] = useState('');
  const [attempt, setAttempt] = useState(0);
  const mounted = useRef(true);
  const pending = useRef(false);
  const dirty = Boolean(saved && (JSON.stringify(saved) !== JSON.stringify(draft) || apiKey));
  const latest = useRef({ dirty, saved }); latest.current = { dirty, saved };
  useEffect(() => {
    mounted.current = true;
    const unregister = registerSegmentEditorCloseHandler('settings', owner, {
      isDirty: () => latest.current.dirty || pending.current,
      save: async () => {
        if (!latest.current.dirty && !pending.current) return true;
        setError('请先保存或放弃选区翻译配置，再关闭设置。'); return false;
      },
      discard: () => { setDraft(latest.current.saved); setApiKey(''); latest.current.dirty = false; },
    });
    return () => { mounted.current = false; unregister(); setSegmentEditorDirty('settings', owner, false); };
  }, [owner]);
  useEffect(() => { setSegmentEditorDirty('settings', owner, dirty || busy && Boolean(saved)); }, [owner, dirty, busy, saved]);
  useEffect(() => {
    if (!active || saved) return;
    let cancelled = false;
    setBusy(true); setError('');
    void getSelectionTranslationSettings().then(value => { if (!cancelled) { setSaved(value); setDraft(value); } })
      .catch(() => { if (!cancelled) setError('读取选区翻译设置失败，请重试。'); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [active, attempt]);
  const change = (value: Partial<Settings>) => {
    setDraft(current => current && { ...current, ...value }); setTestResult(''); setError('');
  };
  const run = async (test: boolean) => {
    if (!draft || pending.current) return;
    pending.current = true; setBusy(true); setError(''); setTestResult('');
    const { has_key: _, ...config } = draft;
    const request = { ...config, ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}) };
    try {
      if (test) {
        const result = await testSelectionTranslationService(request);
        if (mounted.current) setTestResult(`测试译文：${result}`);
      } else {
        const result = await saveSelectionTranslationSettings(request);
        if (mounted.current) { setSaved(result); setDraft(result); setApiKey(''); }
      }
    } catch (caught) { if (mounted.current) setError(typeof caught === 'string' ? caught : '操作未完成，请检查配置后重试。'); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  };
  const preset = draft ? presets[draft.provider] : null;
  const input = (field: 'endpoint' | 'model' | 'region', label: string, placeholder = '') => <div className="grid min-w-0 gap-1.5">
    <Label htmlFor={`${owner}-${field}`}>{label}</Label>
    <Input id={`${owner}-${field}`} value={draft?.[field] ?? ''} disabled={busy} placeholder={placeholder}
      autoComplete="off" spellCheck={false} onChange={event => {
        if (field === 'endpoint') { setApiKey(''); change({ endpoint: event.target.value, has_key: false }); }
        else change({ [field]: event.target.value });
      }} />
  </div>;
  return <SettingsGroup id="translation-service" title="选中文字翻译" description="选择一句或一段文字，快速查看中文译文。可单独配置翻译 API，无需下载模型；保存后从下一次选中文字翻译生效。">
    {!draft ? <>{busy ? <p role="status" className="text-xs">正在读取配置…</p> : <Button size="sm" variant="outline" onClick={() => setAttempt(value => value + 1)}>重新读取配置</Button>}</> : <div className="grid min-w-0 gap-3">
      <SettingSelect label="选中文字翻译服务" value={draft.provider} disabled={busy}
        options={Object.entries(presets).map(([value, preset]) => ({ value, label: preset.label }))}
        onValueChange={value => {
          const provider = value as Provider; const preset = presets[provider]; setApiKey('');
          change({ provider, endpoint: preset.endpoint, model: preset.model, region: '', has_key: false });
        }} />
      <p className="text-xs leading-5 text-muted-foreground">{preset?.help}</p>
      {preset?.links && <div aria-label="翻译服务官方入口" className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-primary [&_a]:underline [&_a]:underline-offset-4 [&_a:focus-visible]:outline [&_a:focus-visible]:outline-ring">
        {preset.links.map(link => <WorkspaceWebLink key={link.url} href={link.url}>{link.label}</WorkspaceWebLink>)}
      </div>}
      {draft.provider !== 'reading_model' && <>
        {input('endpoint', '完整请求地址')}
        {draft.provider === 'azure' && input('region', 'Azure 资源区域', '例如 eastasia；全局资源按官方要求留空')}
        {draft.provider === 'qwen_mt' && input('model', '翻译模型名称')}
        <div className="grid gap-1.5"><Label htmlFor={`${owner}-key`}>API Key{draft.has_key ? '（已保存）' : ''}</Label>
          <Input id={`${owner}-key`} type="password" autoComplete="off" spellCheck={false} disabled={busy} maxLength={4096}
            value={apiKey} placeholder={draft.has_key ? '留空沿用；输入新密钥以替换' : '输入自己的服务密钥'}
            onChange={event => { setApiKey(event.target.value); setTestResult(''); setError(''); }} /></div>
        <p className="text-xs leading-5 text-muted-foreground">仅发送选中文字，自动识别原语言并译为简体中文。密钥保存在本机系统凭据库，换电脑需重新填写。服务失败会提示，不自动改用其他服务。</p>
      </>}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {(dirty || busy) && <span role="status" className="mr-auto text-xs text-muted-foreground">{busy ? '处理中…' : '未保存'}</span>}
        {draft.provider !== 'reading_model' && <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(true)}>测试翻译</Button>}
        {dirty && <><Button size="sm" variant="ghost" disabled={busy} onClick={() => { setDraft(saved); setApiKey(''); setError(''); setTestResult(''); }}>放弃修改</Button>
          <Button size="sm" disabled={busy} onClick={() => void run(false)}>保存选区翻译设置</Button></>}
      </div>
      {draft.provider !== 'reading_model' && <p className="text-xs text-muted-foreground">测试仅发送固定英文示例，会使用少量服务额度，不保存配置。</p>}
      {testResult && <p role="status" className="whitespace-pre-wrap break-words text-sm">{testResult}</p>}
    </div>}
    {error && <p role="alert" className="mt-2 text-sm text-destructive [overflow-wrap:anywhere]">{error}</p>}
    {children}
  </SettingsGroup>;
}
