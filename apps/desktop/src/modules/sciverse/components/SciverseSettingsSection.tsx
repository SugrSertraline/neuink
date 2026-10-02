import {
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  PlugZap,
  Save,
  Trash2
} from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SettingsDisclosure, SettingSwitch } from '@/modules/settings/components/SettingsPrimitives';
import { registerSegmentEditorCloseHandler, setSegmentEditorDirty } from '@/modules/reader/components/segmentEditorDirtyRegistry';

import {
  getSciverseSettings,
  revealSciverseApiToken,
  saveSciverseSettings,
  testSciverseConnection
} from '../api/sciverseApi';
import type { SciverseConnectionStatus, SciverseSettingsState } from '../types';

const DEFAULT_BASE_URL = 'https://api.sciverse.space';
const MASKED_TOKEN = '••••••••••••••••';

type SciverseSettingsSectionProps = {
  active: boolean;
};

type BusyAction = 'clear' | 'load' | 'reveal' | 'save' | 'test' | 'toggle' | null;

export function SciverseSettingsSection({ active }: SciverseSettingsSectionProps) {
  const owner = useId();
  const mounted = useRef(true), visible = useRef(active);
  const revealEpoch = useRef(0);
  visible.current = active;
  const [notice, setNotice] = useState<{ tone: string; title: string; description?: string } | null>(null);
  const notify = (value: { tone: string; title: string; description?: string }) => { if (mounted.current) setNotice(value); };
  const [settings, setSettings] = useState<SciverseSettingsState | null>(null);
  const [tokenDraft, setTokenDraft] = useState('');
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const [editingToken, setEditingToken] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [connection, setConnection] = useState<SciverseConnectionStatus | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const latest = useRef({ tokenDraft, busy });
  latest.current = { tokenDraft, busy };
  const writing = busy === 'save' || busy === 'toggle' || busy === 'clear';
  useEffect(() => {
    mounted.current = true;
    const unregister = registerSegmentEditorCloseHandler('settings', owner, {
      isDirty: () => Boolean(latest.current.tokenDraft || ['save', 'toggle', 'clear'].includes(latest.current.busy ?? '')),
      save: async () => {
        if (!latest.current.tokenDraft && !['save', 'toggle', 'clear'].includes(latest.current.busy ?? '')) return true;
        notify({ tone: 'danger', title: '请先保存或放弃 Sciverse Token，再关闭设置。' }); return false;
      },
      discard: () => { setTokenDraft(''); setEditingToken(false); setShowToken(false); setRevealedToken(null); latest.current.tokenDraft = ''; },
    });
    return () => { mounted.current = false; unregister(); setSegmentEditorDirty('settings', owner, false); };
  }, [owner]);
  useEffect(() => { setSegmentEditorDirty('settings', owner, Boolean(tokenDraft || writing)); }, [owner, tokenDraft, writing]);
  useEffect(() => { if (!active) { revealEpoch.current++; setShowToken(false); setRevealedToken(null); } }, [active]);

  useEffect(() => {
    if (!active || loaded) return undefined;

    let cancelled = false;
    setBusy('load');
    setLoadError(null);
    void getSciverseSettings()
      .then((next) => {
        if (cancelled) return;
        applySettings(next);
        setLoaded(true);
      })
      .catch((caught) => {
        if (!cancelled) setLoadError(errorMessage(caught));
      })
      .finally(() => {
        if (!cancelled) setBusy(null);
      });
    return () => {
      cancelled = true;
    };
  }, [active, loadAttempt]);

  const applySettings = (next: SciverseSettingsState) => {
    if (!mounted.current) return;
    setSettings(next);
    setTokenDraft('');
    setRevealedToken(null);
    setEditingToken(false);
    setShowToken(false);
    setConfirmingClear(false);
  };

  const resetConnection = () => {
    setNotice(null);
    setConnection(null);
    setConnectionError(null);
  };

  const saveToken = async () => {
    const token = tokenDraft.trim();
    if (!token) {
      notify({ tone: 'danger', title: '请输入 Sciverse API Token' });
      return;
    }
    if (settings?.token_source === 'environment') {
      notify({
        tone: 'danger',
        title: 'Token 由环境变量管理',
        description: '请修改启动 Neuink 时使用的 SCIVERSE_API_TOKEN。'
      });
      return;
    }

    setBusy('save');
    resetConnection();
    try {
      const next = await saveSciverseSettings({
        apiToken: token,
        baseUrl: settings?.base_url ?? DEFAULT_BASE_URL,
        enabled: settings?.enabled ?? false
      });
      if (!next.has_api_token || next.token_source !== 'credential_store') {
        throw new Error('系统凭据库未能回读刚保存的 Sciverse Token，请重试。');
      }
      applySettings(next);
      notify({
        tone: 'success',
        title: settings?.has_api_token ? 'Sciverse Token 已替换' : 'Sciverse Token 已保存'
      });
    } catch (caught) {
      notifyFailure('保存 Sciverse Token 失败', caught);
    } finally {
      setBusy(null);
    }
  };

  const toggleEnabled = async (enabled: boolean) => {
    if (enabled && !settings?.has_api_token) {
      notify({
        tone: 'danger',
        title: '请先保存 Sciverse API Token',
        description: '保存并测试连接后再启用助手调用。'
      });
      return;
    }
    if (!settings) return;

    setBusy('toggle');
    resetConnection();
    try {
      const next = await saveSciverseSettings({
        baseUrl: settings.base_url,
        enabled
      });
      applySettings(next);
      notify({ tone: 'success', title: enabled ? 'Sciverse 已启用' : 'Sciverse 已停用' });
    } catch (caught) {
      notifyFailure(enabled ? '启用 Sciverse 失败' : '停用 Sciverse 失败', caught);
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    if (!settings?.has_api_token) {
      notify({ tone: 'danger', title: '请先保存 Sciverse API Token' });
      return;
    }
    if (editingToken) {
      notify({
        tone: 'danger',
        title: '请先保存当前 Token',
        description: '连接测试只使用已保存的凭据，不会自动覆盖 Token。'
      });
      return;
    }

    setBusy('test');
    resetConnection();
    try {
      const result = await testSciverseConnection();
      if (!mounted.current) return;
      setConnection(result);
    } catch (caught) {
      const message = errorMessage(caught);
      if (mounted.current) setConnectionError(message);
    } finally {
      setBusy(null);
    }
  };

  const toggleTokenVisibility = async () => {
    if (showToken) {
      setShowToken(false);
      setRevealedToken(null);
      return;
    }
    if (editingToken || !settings?.has_api_token) {
      if (tokenDraft) setShowToken(true);
      return;
    }
    if (!settings?.has_api_token) return;
    if (revealedToken) {
      setShowToken(true);
      return;
    }

    setBusy('reveal');
    const epoch = revealEpoch.current;
    try {
      const token = await revealSciverseApiToken();
      if (!mounted.current || !visible.current || epoch !== revealEpoch.current) return;
      setRevealedToken(token);
      setShowToken(true);
    } catch (caught) {
      notifyFailure('读取 Sciverse Token 失败', caught);
    } finally {
      setBusy(null);
    }
  };

  const copyVisibleToken = async () => {
    const token = editingToken || !hasToken ? tokenDraft : revealedToken;
    if (!showToken || !token) return;
    try {
      await navigator.clipboard.writeText(token);
      notify({ tone: 'success', title: 'Sciverse Token 已复制' });
    } catch (caught) {
      notifyFailure('复制 Sciverse Token 失败', caught);
    }
  };

  const beginTokenReplacement = () => {
    setEditingToken(true);
    setTokenDraft('');
    setRevealedToken(null);
    setShowToken(false);
    resetConnection();
  };

  const cancelTokenReplacement = () => {
    resetConnection();
    setEditingToken(false);
    setTokenDraft('');
    setRevealedToken(null);
    setShowToken(false);
  };

  const clearCredential = async () => {
    if (!settings) return;

    setBusy('clear');
    resetConnection();
    try {
      const next = await saveSciverseSettings({
        baseUrl: settings.base_url,
        clearApiToken: true,
        enabled: false
      });
      applySettings(next);
      notify({ tone: 'success', title: 'Sciverse Token 已清除' });
    } catch (caught) {
      notifyFailure('清除 Sciverse Token 失败', caught);
    } finally {
      setBusy(null);
    }
  };

  const notifyFailure = (title: string, caught: unknown) => {
    notify({ tone: 'danger', title, description: errorMessage(caught) });
  };

  const retryLoad = () => {
    setLoaded(false);
    setLoadError(null);
    setLoadAttempt((current) => current + 1);
  };

  const pending = busy !== null;
  const hasToken = Boolean(settings?.has_api_token);
  const environmentManaged = settings?.token_source === 'environment';
  const editingTokenValue = editingToken || !hasToken;
  const displayedToken = editingTokenValue
    ? tokenDraft
    : hasToken
      ? revealedToken ?? MASKED_TOKEN
      : '';

  return (
    <SettingsDisclosure id="tools-services" title="Sciverse" description="科学文献检索与远程全文读取，需服务 Token。"
      onToggle={open => { if (!open) { revealEpoch.current++; setShowToken(false); setRevealedToken(null); } }}
      status={writing ? '保存中…' : tokenDraft ? '未保存' : notice?.tone === 'danger' || connectionError ? '操作失败' : busy === 'load' ? '读取中…' : loadError ? '读取失败' : !settings ? '未就绪' : settings.enabled ? '已启用' : hasToken ? '未启用' : '未配置'}>
      <div className="sciverse-settings grid min-w-0 gap-3">
        {notice && <p role={notice.tone === 'danger' ? 'alert' : 'status'} className={`text-xs [overflow-wrap:anywhere] ${notice.tone === 'danger' ? 'text-destructive' : 'text-muted-foreground'}`}>{notice.title}{notice.description ? `：${notice.description}` : ''}</p>}
        {writing && <p role="status" className="text-xs text-muted-foreground">保存中…</p>}
        {busy === 'load' ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="animate-spin" size={14} />
            正在读取 Sciverse 配置…
          </div>
        ) : loadError ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs">
            <div className="font-medium text-destructive">读取 Sciverse 配置失败</div>
            <div className="mt-1 break-words text-muted-foreground">{loadError}</div>
            <Button className="mt-3" size="sm" type="button" variant="outline" onClick={retryLoad}>
              重新读取
            </Button>
          </div>
        ) : settings ? (
          <>
            <SettingSwitch label="允许助手调用 Sciverse" checked={settings.enabled}
              disabled={pending || editingToken || Boolean(tokenDraft) || (!hasToken && !settings.enabled)}
              description={hasToken ? '开关自动保存；密钥需单独保存。' : '先保存 Token，再开启服务。'}
              onCheckedChange={checked => void toggleEnabled(checked)} />
            <div className="grid gap-1 text-xs">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="text-muted-foreground">服务地址</span>
                <span className="font-mono text-[11px]">{settings.base_url}</span>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="text-muted-foreground">凭据状态</span>
                <span>
                  {environmentManaged
                    ? '由 SCIVERSE_API_TOKEN 环境变量管理'
                    : hasToken
                      ? '已保存在系统凭据库'
                      : '尚未配置'}
                </span>
              </div>
            </div>

            <div className="grid gap-2">
              <label className="text-xs font-medium" htmlFor="sciverse-api-token">
                API Token
              </label>
              <div className="sciverse-token-controls">
                <div className="relative min-w-0 flex-1">
                  <KeyRound
                    aria-hidden="true"
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                    size={15}
                  />
                  <Input
                    id="sciverse-api-token"
                    aria-label="Sciverse API Token"
                    className="sciverse-token-input pl-9 pr-16"
                    disabled={pending}
                    placeholder={
                      environmentManaged
                        ? '由环境变量管理'
                        : hasToken
                          ? 'Token 已保存'
                          : '输入 Sciverse API Token'
                    }
                    readOnly={environmentManaged || (hasToken && !editingToken)}
                    type={showToken ? 'text' : 'password'}
                    value={displayedToken}
                    onChange={(event) => {
                      setTokenDraft(event.target.value);
                      resetConnection();
                    }}
                  />
                  <Button size="icon-sm" variant="ghost"
                    aria-label="复制当前显示的 Token"
                    className="absolute right-8 top-1/2 -translate-y-1/2 text-muted-foreground"
                    disabled={pending || !showToken || !(editingTokenValue ? tokenDraft : revealedToken)}
                    title="复制当前显示的 Token"
                    type="button"
                    onClick={() => void copyVisibleToken()}
                  >
                    <Copy size={14} />
                  </Button>
                  <Button size="icon-sm" variant="ghost"
                    aria-label={showToken ? '隐藏 Sciverse Token' : '显示 Sciverse Token'}
                    className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground"
                    disabled={pending || (!hasToken && !tokenDraft)}
                    title={showToken ? '隐藏 Sciverse Token' : '显示 Sciverse Token'}
                    type="button"
                    onClick={() => void toggleTokenVisibility()}
                  >
                    {busy === 'reveal' ? (
                      <Loader2 className="animate-spin" size={15} />
                    ) : showToken ? (
                      <EyeOff size={15} />
                    ) : (
                      <Eye size={15} />
                    )}
                  </Button>
                </div>

                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  {hasToken && !environmentManaged && !editingToken ? (
                    <Button
                      disabled={pending}
                      size="sm"
                      type="button"
                      variant="outline"
                      onClick={beginTokenReplacement}
                    >
                      <KeyRound />
                      替换 Token
                    </Button>
                  ) : !environmentManaged ? (
                    <>
                      <Button
                        disabled={pending || !tokenDraft.trim()}
                        size="sm"
                        type="button"
                        onClick={() => void saveToken()}
                      >
                        {busy === 'save' ? <Loader2 className="animate-spin" /> : <Save />}
                        {hasToken ? '保存新 Token' : '保存 Token'}
                      </Button>
                      {editingToken || tokenDraft ? (
                        <Button
                          disabled={pending}
                          size="sm"
                          type="button"
                          variant="ghost"
                          onClick={cancelTokenReplacement}
                        >
                          {hasToken ? '取消替换' : '放弃输入'}
                        </Button>
                      ) : null}
                    </>
                  ) : null}
                  <Button
                    aria-label="测试 Sciverse 连接"
                    disabled={pending || !hasToken || editingToken}
                    size="sm"
                    title={editingToken ? '请先保存或取消当前替换' : '使用已保存的 Token 测试连接'}
                    type="button"
                    variant="outline"
                    onClick={() => void test()}
                  >
                    {busy === 'test' ? <Loader2 className="animate-spin" /> : <PlugZap />}
                    测试连接
                  </Button>
                  {settings.token_source === 'credential_store' ? (
                    <Button
                      aria-label="清除 Sciverse Token"
                      disabled={pending || editingToken || Boolean(tokenDraft)}
                      size="sm"
                      type="button"
                      variant="ghost"
                      onClick={() => setConfirmingClear(true)}
                    >
                      <Trash2 />
                      清除
                    </Button>
                  ) : null}
                </div>
              </div>
              {editingToken || tokenDraft.trim() ? (
                <p className="text-[11px] leading-5 text-muted-foreground">
                  未保存。保存后才能测试连接。
                </p>
              ) : null}
            </div>

            {confirmingClear ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3">
                <div className="text-xs">
                  <div className="font-medium text-destructive">确认清除系统凭据库中的 Token？</div>
                  <div className="mt-1 text-muted-foreground">清除后会同时停用 Sciverse。</div>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" type="button" disabled={pending} variant="ghost" onClick={() => setConfirmingClear(false)}>
                    取消
                  </Button>
                  <Button size="sm" type="button" disabled={pending} variant="destructive" onClick={() => void clearCredential()}>
                    确认清除
                  </Button>
                </div>
              </div>
            ) : null}

            {connection?.ok ? (
              <div role="status" className="flex items-center gap-2 text-xs text-success">
                <CheckCircle2 size={14} aria-hidden="true" />
                连接正常，服务返回 {connection.field_count} 个可用元数据字段。
              </div>
            ) : connectionError ? (
              <div role="alert" className="text-xs">
                <div className="font-medium text-destructive">连接失败</div>
                <div className="mt-1 break-words text-muted-foreground">{connectionError}</div>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </SettingsDisclosure>
  );
}

function errorMessage(caught: unknown) {
  return caught instanceof Error ? caught.message : String(caught);
}
