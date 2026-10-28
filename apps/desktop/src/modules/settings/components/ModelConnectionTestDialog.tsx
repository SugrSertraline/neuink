import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Circle, CircleAlert, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { LlmProfile } from '@/shared/ipc/assistantApi';
import { openTranslationLogs } from '@/shared/ipc/translationLogApi';
import { diagnosticReport, initialDiagnosticSteps, runModelDiagnostics, type DiagnosticStep } from '../modelConnectionDiagnostics';

type Result = { status: 'success' | 'error' | 'idle'; message?: string };
const labels = { pending: '等待测试', testing: '测试中', success: '通过', error: '未通过', cancelled: '已取消' };

/** Owns a fixed configuration snapshot and its request lifetime. Only the body scrolls. */
export function ModelConnectionTestDialog({ profile, onClose, onResult }: {
  profile: LlmProfile; onClose: () => void; onResult: (result: Result) => void;
}) {
  const [steps, setSteps] = useState(initialDiagnosticSteps);
  const [running, setRunning] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [copyMessage, setCopyMessage] = useState('');
  const controllerRef = useRef<AbortController>();
  const resultRef = useRef(onResult);
  resultRef.current = onResult;

  useEffect(() => {
    const controller = new AbortController();
    controllerRef.current = controller;
    let mounted = true;
    setSteps(initialDiagnosticSteps()); setRunning(true); setCopyMessage('');
    // StrictMode's discarded mount must not send a paid model request.
    queueMicrotask(async () => {
      if (controller.signal.aborted) return;
      try {
        const result = await runModelDiagnostics(profile, controller.signal, next => {
          if (mounted && !controller.signal.aborted) setSteps(next);
        });
        if (!mounted || controller.signal.aborted) return;
        const failed = result.filter(step => step.status === 'error');
        resultRef.current(failed.length ? { status: 'error', message: failed.map(s => `${s.label}：${s.message}`).join('；') }
          : { status: 'success', message: '选中文字与片段／批量翻译测试通过。' });
      } catch {
        if (!mounted) return;
        setSteps(current => current.map(step => ['pending', 'testing'].includes(step.status)
          ? { ...step, status: controller.signal.aborted ? 'cancelled' : 'error', message: controller.signal.aborted ? '测试已停止。' : '测试未完成，请重试。' } : step));
        resultRef.current({ status: controller.signal.aborted ? 'idle' : 'error', message: controller.signal.aborted ? '上次测试已取消。' : '测试未完成，请重试。' });
      } finally { if (mounted) setRunning(false); }
    });
    return () => { mounted = false; controller.abort(); };
  }, [profile, attempt]);

  const cancel = () => {
    controllerRef.current?.abort();
    setSteps(current => current.map(step => ['pending', 'testing'].includes(step.status) ? { ...step, status: 'cancelled' } : step));
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(diagnosticReport(profile, steps)); setCopyMessage('诊断信息已复制。'); }
    catch { setCopyMessage('复制失败，请重试。'); }
  };
  return <Dialog open onOpenChange={open => { if (!open) { cancel(); onClose(); } }}>
    <DialogContent className="flex max-h-[min(85vh,640px)] flex-col overflow-hidden sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>连接与翻译测试</DialogTitle>
        <DialogDescription>用固定示例检查当前模型的两种翻译调用，会产生少量模型用量；不修改配置或论文。</DialogDescription>
      </DialogHeader>
      <div className="min-h-0 overflow-y-auto space-y-3">
        <p className="break-all text-sm font-medium">{profile.name} · {profile.model}</p>
        <div className="divide-y rounded-md border px-3" aria-live="polite">
          {steps.map(step => <DiagnosticRow key={step.label} step={step} />)}
        </div>
        <p className="text-xs leading-5 text-muted-foreground">每项最多等待 90 秒。结果反映本次调用是否可用，不代表所有论文都能成功翻译。独立选区翻译服务仍在翻译设置中单独测试。</p>
        {copyMessage && <p role="status" className="text-xs text-muted-foreground">{copyMessage}</p>}
      </div>
      <DialogFooter className="flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => void copy()}>复制诊断信息</Button>
        <Button size="sm" variant="outline" onClick={() => void openTranslationLogs().catch(() => setCopyMessage('无法打开日志目录，请检查数据目录权限。'))}>打开错误日志</Button>
        {running ? <Button size="sm" variant="outline" onClick={cancel}>取消测试</Button>
          : <Button size="sm" variant="outline" onClick={() => setAttempt(value => value + 1)}>重新测试</Button>}
        <Button size="sm" onClick={() => { cancel(); onClose(); }}>关闭</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

function DiagnosticRow({ step }: { step: DiagnosticStep }) {
  const Icon = step.status === 'testing' ? Loader2 : step.status === 'success' ? CheckCircle2 : step.status === 'error' ? CircleAlert : Circle;
  const tone = step.status === 'error' ? 'text-destructive' : step.status === 'success' ? 'text-success' : 'text-muted-foreground';
  return <section className="py-3">
    <div className="flex items-center gap-2 text-sm">
      <Icon aria-hidden className={`size-4 shrink-0 ${tone} ${step.status === 'testing' ? 'animate-spin' : ''}`} />
      <span className="flex-1 font-medium">{step.label}</span>
      <span className={`text-xs ${tone}`}>{labels[step.status]}</span>
      {step.elapsedMs != null && <span className="text-xs tabular-nums text-muted-foreground">{(step.elapsedMs / 1000).toFixed(1)} 秒</span>}
    </div>
    {step.message && <p className={`mt-2 break-words text-xs leading-5 ${tone}`}>{step.message}</p>}
    {step.status === 'error' && step.code && <p className="mt-1 text-xs text-muted-foreground">诊断代码：{step.code}</p>}
  </section>;
}
