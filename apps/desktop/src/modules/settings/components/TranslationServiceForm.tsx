import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { WorkspaceWebLink } from '@/shared/components/WorkspaceWebLink';
import { saveTranslationService, testSelectionTranslationService,
  type SelectionTranslationSettings as Settings, type TranslationServiceProvider } from '@/shared/ipc/selectionTranslationApi';
import { registerSegmentEditorCloseHandler, setSegmentEditorDirty } from '@/modules/reader/components/segmentEditorDirtyRegistry';
import { SettingsDisclosure, SettingSelect } from './SettingsPrimitives';

import { translationServices } from '../translationServices';
import { useFormRecovery } from '@/shared/hooks/useFormRecovery';

/** This component owns the draft; settings-viewport owns scrolling. Native controls retain keyboard behavior. */
export function TranslationServiceForm({ initial }: { initial: Settings }) {
  const owner = useId();
  const disclosure = useRef<HTMLDetailsElement>(null);
  const [saved, setSaved] = useState<Settings>(initial);
  const [draft, setDraft] = useState<Settings>(initial);
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [testResult, setTestResult] = useState('');
  const mounted = useRef(true);
  const pending = useRef(false);
  const generation = useRef(0);
  const reveal = () => {
    if (disclosure.current) disclosure.current.open = true;
    requestAnimationFrame(() => {
      const input = document.getElementById(`${owner}-key`);
      input?.scrollIntoView({ block: 'center' }); input?.focus({ preventScroll: true });
    });
  };
  const dirty = Boolean(saved && (JSON.stringify(saved) !== JSON.stringify(draft) || apiKey));
  const recovery = useFormRecovery({ id: `translation-service-${initial.provider}`, label: `${translationServices[initial.provider as TranslationServiceProvider].label} · 翻译配置`,
    targetId: 'translation-sources', value: { draft, apiKey }, secretFields: ['apiKey'], dirty,
    restore: value => { if (value.draft.provider !== initial.provider) throw new Error('服务不匹配'); setDraft(value.draft); setApiKey(value.apiKey); },
    reveal });
  useEffect(() => { if (recovery.pending && disclosure.current) disclosure.current.open = true; }, [recovery.pending?.key]);
  const recoveryRef = useRef(recovery); recoveryRef.current = recovery;
  const latest = useRef({ dirty, saved }); latest.current = { dirty, saved };
  useEffect(() => {
    mounted.current = true;
    const unregister = registerSegmentEditorCloseHandler('settings', owner, {
      ...recovery.handlers,
      isBusy: () => pending.current,
      settingsTargetId: 'translation-sources',
      label: () => `${translationServices[latest.current.saved.provider as TranslationServiceProvider].label} · 翻译服务配置`,
      reveal,
      isDirty: () => latest.current.dirty || pending.current,
      save: async () => {
        if (!latest.current.dirty && !pending.current) return true;
        setError('请先验证并保存或放弃翻译服务配置，再关闭设置。'); return false;
      },
      discard: () => { generation.current++; recoveryRef.current.discard(); setDraft(latest.current.saved); setApiKey(''); latest.current.dirty = false; },
    });
    return () => { mounted.current = false; generation.current++; unregister(); setSegmentEditorDirty('settings', owner, false); };
  }, [owner]);
  useEffect(() => { setSegmentEditorDirty('settings', owner, dirty || busy && Boolean(saved)); }, [owner, dirty, busy, saved]);
  const change = (value: Partial<Settings>) => {
    setDraft(current => current && { ...current, ...value }); setTestResult(''); setError('');
  };
  const run = async (test: boolean) => {
    if (!draft || pending.current || recovery.blocked) return;
    const version = generation.current;
    pending.current = true; setBusy(true); setError(''); setTestResult('');
    const { has_key: _, ...config } = draft;
    const request = { ...config, ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}) };
    try {
      if (test) {
        const result = await testSelectionTranslationService(request);
        if (mounted.current && version === generation.current) setTestResult(`测试译文：${result}`);
      } else {
        await testSelectionTranslationService(request);
        if (!mounted.current || version !== generation.current) return;
        const result = await saveTranslationService(request);
        if (mounted.current && version === generation.current) { setSaved(result); setDraft(result); setApiKey(''); setTestResult('验证成功，配置已保存。可在下方“翻译行为”中选择使用。'); }
      }
    } catch (caught) { if (mounted.current && version === generation.current) setError(typeof caught === 'string' ? caught : '操作未完成，请检查配置后重试。'); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  };
  const preset = translationServices[draft.provider as TranslationServiceProvider];
  const input = (field: 'endpoint' | 'model' | 'region', label: string, placeholder = '') => <div className="grid min-w-0 gap-1.5">
    <Label htmlFor={`${owner}-${field}`}>{label}</Label>
    <Input id={`${owner}-${field}`} value={draft?.[field] ?? ''} disabled={busy} placeholder={placeholder}
      autoComplete="off" spellCheck={false} onChange={event => {
        if (field === 'endpoint') { setApiKey(''); change({ endpoint: event.target.value, has_key: false }); }
        else change({ [field]: event.target.value });
      }} />
  </div>;
  const status = busy ? '处理中…' : recovery.pending ? '有恢复草稿' : error ? '操作失败' : dirty ? '未保存' : draft.has_key ? '已配置' : '未配置';
  return <SettingsDisclosure ref={disclosure} id={`translation-service-${draft.provider}`} title={preset.label}
    description={draft.provider === 'qwen_mt' ? draft.model : undefined} status={status} attention={Boolean(error || dirty || recovery.pending)}>
    {recovery.notice}
    <fieldset disabled={recovery.blocked} className="grid min-w-0 gap-3">
      <p className="text-xs leading-5 text-muted-foreground">{preset?.help}</p>
      <div className="text-xs text-primary underline underline-offset-4"><WorkspaceWebLink href={preset.url}>官方接入说明 / 申请密钥</WorkspaceWebLink></div>
      <>
        {draft.provider === 'deepl' && <SettingSelect label="DeepL 套餐地址" value={draft.endpoint.includes('api-free.deepl.com') ? 'free' : draft.endpoint === 'https://api.deepl.com/v2/translate' ? 'pro' : 'custom'} disabled={busy}
          options={[{ value: 'free', label: 'API Free / 测试账户' }, { value: 'pro', label: 'API Pro' }, { value: 'custom', label: '自定义地址' }]}
          onValueChange={value => { if (value === 'custom') return; setApiKey(''); change({ endpoint: value === 'free' ? 'https://api-free.deepl.com/v2/translate' : 'https://api.deepl.com/v2/translate', has_key: false }); }} />}
        {input('endpoint', '完整请求地址')}
        {draft.provider === 'azure' && input('region', 'Azure 资源区域', '例如 eastasia；全局资源按官方要求留空')}
        {draft.provider === 'qwen_mt' && input('model', '翻译模型名称')}
        <div className="grid gap-1.5"><Label htmlFor={`${owner}-key`}>API Key{draft.has_key ? '（已保存）' : ''}</Label>
          <Input id={`${owner}-key`} type="password" autoComplete="off" spellCheck={false} disabled={busy} maxLength={4096}
            value={apiKey} placeholder={draft.has_key ? '留空沿用；输入新密钥以替换' : '输入自己的服务密钥'}
            onChange={event => { setApiKey(event.target.value); setTestResult(''); setError(''); }} /></div>
        <p className="text-xs leading-5 text-muted-foreground">密钥保存在本机系统凭据库，不显示已有密钥。留空沿用；更换请求地址后需重新填写。</p>
      </>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {(dirty || busy) && <span role="status" className="mr-auto text-xs text-muted-foreground">{busy ? '处理中…' : '未保存'}</span>}
        <Button size="sm" variant="outline" disabled={busy || (!apiKey.trim() && !draft.has_key)} onClick={() => void run(true)}>测试翻译</Button>
        {dirty && <><Button size="sm" variant="ghost" disabled={busy} onClick={() => { setDraft(saved); setApiKey(''); setError(''); setTestResult(''); }}>放弃修改</Button>
          <Button size="sm" disabled={busy || (!apiKey.trim() && !draft.has_key)} onClick={() => void run(false)}>验证并保存</Button></>}
      </div>
<p className="text-xs text-muted-foreground">测试与验证仅发送固定英文示例，使用少量服务额度；验证成功后才保存配置。</p>
      {testResult && <p role="status" className="whitespace-pre-wrap break-words text-sm">{testResult}</p>}
    </fieldset>
    {error && <p role="alert" className="mt-2 text-sm text-destructive [overflow-wrap:anywhere]">{error}</p>}
  </SettingsDisclosure>;
}
