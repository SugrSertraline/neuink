import { useEffect, useRef, useState } from 'react';
import type { LlmApiProtocol } from '@/shared/ipc/assistantApi';

export type ModelSyncState = { status: 'idle' | 'waiting' | 'loading' | 'success' | 'error'; message: string };

/** Only the open editor owns requests. Credentials stay in memory, never in cache keys. */
export function useModelAutoSync({ open, baseUrl, apiKey, apiProtocol, sync }: {
  open: boolean; baseUrl: string; apiKey: string; apiProtocol: LlmApiProtocol;
  sync: (signal: AbortSignal) => Promise<void>;
}) {
  const [state, setState] = useState<ModelSyncState>({ status: 'idle', message: '' });
  const [retry, setRetry] = useState(0);
  const syncRef = useRef(sync);
  syncRef.current = sync;
  useEffect(() => {
    if (!open) { setState({ status: 'idle', message: '' }); return; }
    let url: URL;
    try { url = new URL(baseUrl.trim()); } catch { setState({ status: 'idle', message: '填写接口地址后自动同步' }); return; }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))) {
      setState({ status: 'idle', message: '请填写 HTTPS 接口地址（本地服务可用 HTTP）' }); return;
    }
    if (!apiKey.trim() && !local) { setState({ status: 'idle', message: '填写 API Key 后自动同步；现在可使用公开预设' }); return; }
    const controller = new AbortController();
    let active = true;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    setState({ status: 'waiting', message: '输入结束后自动同步…' });
    const debounce = setTimeout(async () => {
      setState({ status: 'loading', message: '正在同步接口模型…' });
      timeout = setTimeout(() => {
        controller.abort();
        if (active) setState({ status: 'error', message: '接口同步超时，仍可选择预设或手动填写' });
      }, 20_000);
      try {
        await syncRef.current(controller.signal);
        if (active && !controller.signal.aborted) setState({ status: 'success', message: '接口模型已同步' });
      } catch (error) {
        if (active && !controller.signal.aborted) {
          // Do not display arbitrary upstream text: it can echo credentials or private URLs.
          const code = error instanceof Error ? error.message.match(/HTTP\s+(\d{3})\b/)?.[1] : undefined;
          const reason = code === '401' || code === '403' ? '请检查密钥、模型列表权限或服务地区限制'
            : code === '404' ? '请检查接口地址；服务也可能不提供模型列表'
            : code === '429' ? '请求受到限流，请稍后重试' : '请检查连接；仍可选择预设或手动填写';
          setState({ status: 'error', message: `同步失败${code ? `（HTTP ${code}）` : ''}：${reason}` });
        }
      } finally { clearTimeout(timeout); }
    }, 800);
    return () => { active = false; clearTimeout(debounce); clearTimeout(timeout); controller.abort(); };
  }, [open, baseUrl, apiKey, apiProtocol, retry]);
  return { ...state, retry: () => setRetry(value => value + 1) };
}
