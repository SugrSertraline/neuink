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
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/shared/hooks/useToast';

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
  const { notify } = useToast();
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
    setSettings(next);
    setTokenDraft('');
    setRevealedToken(null);
    setEditingToken(false);
    setShowToken(false);
    setConfirmingClear(false);
  };

  const resetConnection = () => {
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
      setConnection(result);
      notify({ tone: 'success', title: 'Sciverse 连接成功' });
    } catch (caught) {
      const message = errorMessage(caught);
      setConnectionError(message);
      notifyFailure('Sciverse 连接失败', caught);
    } finally {
      setBusy(null);
    }
  };

  const toggleTokenVisibility = async () => {
    if (showToken) {
      setShowToken(false);
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
    try {
      const token = await revealSciverseApiToken();
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
    <section className="overflow-hidden rounded-lg border bg-card">
      <div className="flex flex-wrap items-start justify-between gap-4 p-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-md border bg-muted/35 text-primary">
            <PlugZap size={17} aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold">Sciverse</h3>
              <span
                className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                  settings?.enabled
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                    : 'text-muted-foreground'
                }`}
              >
                {settings?.enabled ? '已启用' : '已停用'}
              </span>
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              为助手提供外部科学文献检索和远程全文读取。
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">允许助手调用</span>
          <Switch
            aria-label="允许助手调用 Sciverse"
            checked={settings?.enabled ?? false}
            disabled={pending || !settings || editingToken || Boolean(tokenDraft.trim())}
            onCheckedChange={(checked) => void toggleEnabled(checked)}
          />
        </div>
      </div>

      <div className="grid gap-4 border-t bg-background/55 p-4">
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
              <div className="flex min-w-0 flex-col gap-2 lg:flex-row lg:items-center">
                <div className="relative min-w-0 flex-1">
                  <KeyRound
                    aria-hidden="true"
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                    size={15}
                  />
                  <Input
                    id="sciverse-api-token"
                    aria-label="Sciverse API Token"
                    className="sciverse-token-input h-9 pl-9 pr-16 font-mono text-xs"
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
                  <button
                    aria-label="复制当前显示的 Token"
                    className="absolute right-8 top-1/2 grid size-7 -translate-y-1/2 place-items-center text-muted-foreground hover:text-foreground disabled:opacity-40"
                    disabled={pending || !showToken || !(editingTokenValue ? tokenDraft : revealedToken)}
                    title="复制当前显示的 Token"
                    type="button"
                    onClick={() => void copyVisibleToken()}
                  >
                    <Copy size={14} />
                  </button>
                  <button
                    aria-label={showToken ? '隐藏 Sciverse Token' : '显示 Sciverse Token'}
                    className="absolute right-1 top-1/2 grid size-7 -translate-y-1/2 place-items-center text-muted-foreground hover:text-foreground disabled:opacity-40"
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
                  </button>
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-2">
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
                      {hasToken && editingToken ? (
                        <Button
                          disabled={pending}
                          size="sm"
                          type="button"
                          variant="ghost"
                          onClick={cancelTokenReplacement}
                        >
                          取消替换
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
                      disabled={pending}
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
                  正在替换 Token。连接测试不会自动保存或覆盖当前输入。
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
                  <Button size="sm" type="button" variant="ghost" onClick={() => setConfirmingClear(false)}>
                    取消
                  </Button>
                  <Button size="sm" type="button" variant="destructive" onClick={() => void clearCredential()}>
                    确认清除
                  </Button>
                </div>
              </div>
            ) : null}

            {connection?.ok ? (
              <div className="flex items-center gap-2 rounded-md border border-emerald-500/25 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 size={14} aria-hidden="true" />
                连接正常，服务返回 {connection.field_count} 个可用元数据字段。
              </div>
            ) : connectionError ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs">
                <div className="font-medium text-destructive">连接失败</div>
                <div className="mt-1 break-words text-muted-foreground">{connectionError}</div>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </section>
  );
}

function errorMessage(caught: unknown) {
  return caught instanceof Error ? caught.message : String(caught);
}
