import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { testLocalAgentConnection } from '@/shared/ipc/localAgentApi';
import { localAgentName, type LocalAgentProvider } from '@/shared/lib/localAgentSettings';
import { safeLocalAgentError } from '@/shared/lib/localAgentErrors';

/** Each row owns its explicit test; the settings viewport remains the scroll owner. */
export function LocalAgentConnectionTest({ provider, available }: { provider: LocalAgentProvider; available: boolean }) {
  const pending = useRef<AbortController | null>(null);
  const [state, setState] = useState<{ kind: 'idle' | 'testing' | 'ready' | 'error'; message: string }>({ kind: 'idle', message: '' });
  useEffect(() => {
    if (!available) setState({ kind: 'idle', message: '' });
    return () => { pending.current?.abort(); pending.current = null; };
  }, [available]);
  const start = async () => {
    if (!available || pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setState({ kind: 'testing', message: '正在验证模型响应和 NeuInk 工具连接…' });
    try {
      await testLocalAgentConnection(provider, controller.signal);
      if (!controller.signal.aborted) setState({ kind: 'ready', message: '模型响应和 NeuInk 工具连接正常。' });
    } catch (error) {
      if (!controller.signal.aborted) setState({ kind: 'error', message: safeLocalAgentError(error) ?? '连接测试失败，请检查本机登录、模型和网络配置后重试。' });
    } finally { if (pending.current === controller) pending.current = null; }
  };
  return <div className="mt-2">
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" variant="outline" aria-label={`测试 ${localAgentName(provider)} 连接`}
        title="使用固定示例验证模型和工具连接，可能消耗少量额度；不发送资料库内容。"
        disabled={!available || state.kind === 'testing'} onClick={() => void start()}>测试连接</Button>
      {state.kind === 'testing' && <Button type="button" size="sm" variant="ghost" onClick={() => {
        pending.current?.abort(); pending.current = null; setState({ kind: 'idle', message: '连接测试已取消。' });
      }}>取消测试</Button>}
    </div>
    {state.message && <p role={state.kind === 'error' ? 'alert' : 'status'} className={`mt-1 text-xs ${state.kind === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>{state.message}</p>}
  </div>;
}
