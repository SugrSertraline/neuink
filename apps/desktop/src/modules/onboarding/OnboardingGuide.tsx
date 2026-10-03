import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Circle, ListChecks, Pause, SkipForward } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ViewportOverlay } from '@/components/ui/viewport-overlay';
import type { EntryMeta } from '@/shared/types/domain';
import type { WorkspaceSurfaceLayout } from '@/app/workspaceSurface';
import { GUIDE_STEPS, GUIDE_TASKS, type GuideRoute, type GuideSignal } from './catalog';
import { freshProgress, GUIDE_MINERU_TUTORIAL_EVENT, GUIDE_OPEN_EVENT, GUIDE_PROGRESS_EVENT, GUIDE_STORAGE_KEY, readProgress, resolveStep } from './progress';
import { findSpotlightTarget, useSpotlight } from './useSpotlight';
import { useGuideInteractionBoundary } from './useGuideInteractionBoundary';
import { GuideInteractionShield } from './GuideInteractionShield';
import { OBSERVE_GUIDE } from './guideInteractionPolicy';
import { useGuideScrollLock } from './useGuideScrollLock';
import { findLocalOnboardingPaper } from './samplePaper';
import { placeGuidePanel, placeGuideTargetCue } from './guidePlacement';
import { GuidePdfDemonstration, type PdfDemoMode } from './GuidePdfDemonstration';
import { GUIDE_ACTIONS } from './guideActions';
import { useToast } from '@/shared/hooks/useToast';
import { guideSurfaceKey } from './guideSurface';

type Props = { storageKey?: string; root: string | null; ready: boolean; entries: EntryMeta[]; selectedEntryId: string | null;
  layout: WorkspaceSurfaceLayout; onRoute: (route: GuideRoute, entryId: string | null) => void;
  onImportSample: () => Promise<string> };

function isGuideTargetVisible(element: HTMLElement) {
  const bounds = element.getBoundingClientRect();
  return bounds.width > 0 && bounds.height > 0
    && !element.closest('[hidden], [aria-hidden="true"], .is-hidden')
    && element.getAttribute('data-state') !== 'closed';
}

export function OnboardingGuide(props: Props) {
  const { notify, dismiss } = useToast();
  const [progress, setProgress] = useState(() => readProgress(props.storageKey));
  const [open, setOpen] = useState(false);
  const [openAttempt, setOpenAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [preparedRoot, setPreparedRoot] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signal, setSignal] = useState(false);
  const importGeneration = useRef(0);
  const rootRef = useRef(props.root); rootRef.current = props.root;
  const progressRef = useRef(progress); progressRef.current = progress;
  const save = (next: typeof progress) => { setProgress(next); try { localStorage.setItem(props.storageKey ?? GUIDE_STORAGE_KEY, JSON.stringify(next)); window.dispatchEvent(new Event(GUIDE_PROGRESS_EVENT)); } catch { setError('教程进度无法保存到本机；本次仍可继续，重启后可能需要重来。'); } };
  useEffect(() => {
    if (!open || progress.current !== 'parse-choices') return;
    const advance = () => save(resolveStep(progressRef.current, false));
    window.addEventListener(GUIDE_MINERU_TUTORIAL_EVENT, advance);
    return () => window.removeEventListener(GUIDE_MINERU_TUTORIAL_EVENT, advance);
  }, [open, progress.current]);
  useEffect(() => {
    const receive = (event: Event) => {
      if (busy) return;
      if ((event as CustomEvent<{ reset?: boolean }>).detail?.reset) {
        save({ ...freshProgress(), seen:true });
      }
      setPreparedRoot(null); setError(null);
      setOpenAttempt(value => value + 1);
      setOpen(true);
    };
    window.addEventListener(GUIDE_OPEN_EVENT, receive);
    return () => window.removeEventListener(GUIDE_OPEN_EVENT, receive);
  }, [busy]);
  useEffect(() => {
    if (props.ready && props.root && !progress.seen && props.entries.length === 0) {
      const next = { ...progress, seen:true }; save(next); setOpen(true);
    }
  }, [props.ready, props.root, props.entries.length, progress.seen]);
  useEffect(() => {
    importGeneration.current++;
    setBusy(false); setError(null); setPreparedRoot(null);
  }, [props.root]);
  useEffect(() => () => { importGeneration.current++; }, []);
  const sampleAttempt = useRef<string | null>(null);
  const onSample = async () => {
    if (busy || !props.ready || !props.root) return;
    const generation = ++importGeneration.current; const root = props.root;
    setBusy(true); setError(null);
    try {
      const entryId = await props.onImportSample();
      if (generation !== importGeneration.current || rootRef.current !== root) return;
      save({ ...progressRef.current, entryId, root });
      setPreparedRoot(root);
    } catch (caught) {
      if (generation === importGeneration.current) setError(caught instanceof Error ? caught.message : String(caught));
    } finally { if (generation === importGeneration.current) setBusy(false); }
  };
  const sampleAction = useRef(onSample); sampleAction.current = onSample;
  useEffect(() => {
    if (!open) { sampleAttempt.current = null; return; }
    if (!props.ready || !props.root) return;
    const key = JSON.stringify([props.root, openAttempt]);
    if (sampleAttempt.current === key) return;
    sampleAttempt.current = key;
    void sampleAction.current();
  }, [open, openAttempt, props.root, props.ready]);
  const pause = () => {
    setOpen(false);
    const toastId = notify({ title:'新手引导已暂停', durationMs:7000,
      description:'可从「设置 → 资料库与数据 → 新手引导 → 继续新手引导」恢复，当前进度已保留。',
      action:<Button size="sm" variant="outline" onClick={() => { dismiss(toastId); props.onRoute('onboarding-settings', null); }}>前往设置</Button> });
  };
  if (!open) return null;
  return <GuideOverlay {...props} progress={progress} save={save} busy={busy || (props.ready && Boolean(props.root) && preparedRoot !== props.root && !error)} error={error}
    signal={signal} setSignal={setSignal} onPause={pause} onClose={() => setOpen(false)}
    onSample={() => void onSample()} />;
}

function GuideOverlay({ progress, save, busy, error, signal, setSignal, onPause, onClose, onSample, ...props }:
  Props & { progress:ReturnType<typeof freshProgress>; save:(next:ReturnType<typeof freshProgress>) => void;
    busy:boolean; error:string | null; signal:boolean; setSignal:(value:boolean) => void; onPause:() => void; onClose:() => void; onSample:() => void }) {
  const step = GUIDE_STEPS.find(value => value.id === progress.current) ?? GUIDE_STEPS[0];
  const index = GUIDE_STEPS.indexOf(step);
  const viewport = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const instructions = useRef<HTMLDivElement>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [activeModal, setActiveModal] = useState<HTMLElement | null>(null);
  const modalOpenRef = useRef(modalOpen); modalOpenRef.current = modalOpen;
  const [routedStep, setRoutedStep] = useState<string | null>(null);
  const [instructionFocus, setInstructionFocus] = useState({ stepId: step.id, index: 0 });
  const focusedInstruction = instructionFocus.stepId === step.id ? instructionFocus.index : 0;
  const focusInstruction = (index: number) => setInstructionFocus({ stepId: step.id, index });
  const boundId = progress.root === props.root ? progress.entryId : null;
  const currentEntry = boundId ? props.entries.find(entry => entry.id === boundId && entry.pdf)
    : findLocalOnboardingPaper(props.entries);
  const routeNoteId = step.route === 'pdf-note' || step.route === 'note'
    ? currentEntry?.contents.slice().reverse().find(item => item.kind === 'note')?.note_id ?? null : null;
  const targetSurfaceKey = guideSurfaceKey(step, props.layout, currentEntry?.id ?? null, routeNoteId);
  const routeKey = JSON.stringify([props.root, step.id, progress.entryId, targetSurfaceKey]);
  const highlightReady = !modalOpen && !busy && !error && routedStep === routeKey;
  const contentRect = useSpotlight(step.target, viewport, highlightReady, routeKey, targetSurfaceKey);
  const measuredRelated = useSpotlight(step.relatedTarget ?? step.target, viewport, highlightReady && Boolean(step.relatedTarget), `${routeKey}:related`);
  const relatedRect = step.relatedTarget ? measuredRelated : null;
  const rect = contentRect && (!step.relatedTarget || relatedRect) ? contentRect : null;
  useGuideScrollLock(step.target, step.relatedTarget, viewport, Boolean(rect) && !modalOpen
    && ((step.interaction?.mode ?? 'observe') === 'observe' || step.interaction?.scroll === false), targetSurfaceKey);
  const cue = step.instructionCues ? step.instructionCues[Math.min(focusedInstruction, step.instructionCues.length - 1)] : step.cue;
  const cueTarget = cue?.target ?? step.target;
  const measuredCue = useSpotlight(cueTarget, viewport, highlightReady && Boolean(cue) && cueTarget !== step.target && cueTarget !== step.relatedTarget, `${routeKey}:${cueTarget}`, targetSurfaceKey);
  const cueRect = cue && rect ? cueTarget === step.target ? rect : cueTarget === step.relatedTarget ? relatedRect : measuredCue : null;
  const cuePlacement = placeGuideTargetCue(cueRect, cue?.label ?? '');
  const popupRects = useGuideInteractionBoundary({ selector:step.target, viewport, panel, enabled:!modalOpen,
    relatedSelector:step.relatedTarget, highlighted:Boolean(rect), stepKey:routeKey, interaction:step.interaction ?? OBSERVE_GUIDE, surfaceKey:targetSurfaceKey });
  useEffect(() => {
    if (step.id !== 'welcome') return;
    const syncFromNavigation = (event: Event) => {
      const button = event.target instanceof Element ? event.target.closest('.activitybar button') : null;
      if (!button) return;
      const itemIndex = step.instructionCues?.findIndex(item => button.matches(item.target)) ?? -1;
      if (itemIndex >= 0) setInstructionFocus({ stepId: step.id, index: itemIndex });
    };
    document.addEventListener('mouseover', syncFromNavigation);
    document.addEventListener('focusin', syncFromNavigation);
    return () => { document.removeEventListener('mouseover', syncFromNavigation); document.removeEventListener('focusin', syncFromNavigation); };
  }, [step.id]);
  const routeRef = useRef(props.onRoute); routeRef.current = props.onRoute;
  const lastRoute = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!props.ready || busy || error || modalOpen) return;
    const key = JSON.stringify([props.root, step.id, currentEntry?.id ?? null, routeNoteId]);
    if (lastRoute.current !== key && step.route !== 'none') {
      lastRoute.current = key;
      routeRef.current(step.route, currentEntry?.id ?? null);
    }
    setRoutedStep(routeKey);
  }, [props.ready, props.root, step.id, currentEntry?.id, routeNoteId, modalOpen, busy, error, routeKey]);
  const parsed = currentEntry?.pdf?.parse.status === 'succeeded';
  const missing = (step.id === 'source-note' || step.id === 'write-note') && !currentEntry?.contents.some(item => item.kind === 'note')
    ? '需要先有一篇文档笔记。请回到“创建论文的文档笔记”完成创建，或跳过本步稍后回放。'
    : step.prerequisite === 'parsed' && !parsed ? '需要本篇论文已解析。请先完成解析任务，或跳过本步稍后回放。'
    : step.prerequisite === 'pdf' && !currentEntry?.pdf ? '需要先导入一篇 PDF。可以返回“准备论文”任务，或跳过本步。' : null;
  const active = props.layout.focusedPane === 'right' ? props.layout.right : props.layout.left;
  const observed: Partial<Record<GuideSignal, boolean>> = {
    pdf:active?.kind === 'pdf' && active.entryId === currentEntry?.id,
    parsed,
    split:props.layout.left.kind === 'pdf' && props.layout.right?.kind === 'pdf' && props.layout.left.entryId === currentEntry?.id && props.layout.right.entryId === currentEntry?.id,
    'document-note':active?.kind === 'note' && active.entryId === currentEntry?.id,
  };
  useEffect(() => {
    setSignal(false);
    if (instructions.current) instructions.current.scrollTop = 0;
    let editedNote: HTMLElement | null = null;
    let sawPendingSave = false;
    const checkNoteSave = () => {
      if (!editedNote?.isConnected) return;
      const state = editedNote.dataset.guideNoteSaveState;
      if (state === 'dirty' || state === 'saving') sawPendingSave = true;
      if (sawPendingSave && state === 'saved') setSignal(true);
    };
    const selectors: Partial<Record<GuideSignal,string>> = {
      'translation-task':'[data-guide="translation-task"]', 'translated-view':'[data-guide="translated-mode"][aria-pressed="true"]',
      'segment-editor':'[data-guide="segment-editor"]', 'annotation-editor':'[data-guide="annotation-editor"]', 'proposal':'[data-guide="note-review"]',
    };
    const visible = (selector:string) => [...document.querySelectorAll<HTMLElement>(selector)].some(isGuideTargetVisible);
    const check = () => {
      if (step.signal === 'note-edited') { checkNoteSave(); return; }
      const selector = step.signal && selectors[step.signal];
      if (selector && visible(selector)) setSignal(true);
    };
    const mutations = new MutationObserver(check);
    if (step.signal === 'note-edited') mutations.observe(document.body, { subtree:true, attributes:true, attributeFilter:['data-guide-note-save-state'] });
    else if (step.signal && selectors[step.signal]) mutations.observe(document.body, { childList:true, subtree:true, attributes:true,
      attributeFilter:step.signal === 'segment-editor' || step.signal === 'annotation-editor'
        ? ['class', 'aria-hidden', 'hidden', 'data-state'] : ['aria-pressed', 'hidden', 'data-state'] });
    const interact = (event:Event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target || target.closest('[data-guide-overlay]')) return;
      if (step.signal === 'note-edited' && event.type === 'input' && findSpotlightTarget(step.target, viewport.current, targetSurfaceKey)?.contains(target)) {
        editedNote = target.closest<HTMLElement>('.markdown-note-editor');
        checkNoteSave();
      }
      if (step.signal === 'assistant-context' && event.type === 'click' && target.closest('[data-guide="context-picker"]')) setSignal(true);
      if (step.signal === 'assistant-sent' && event.type === 'click' && target.closest('[data-guide="assistant-send"]:not(:disabled)')) setSignal(true);
    };
    const escape = (event:KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const childOverlay = '[data-slot="dialog-content"], [data-slot="alert-dialog-content"], '
        + '[data-slot="popover-content"], [data-slot="select-content"], [data-slot="dropdown-menu-content"], '
        + '[data-slot="dropdown-menu-sub-content"], [data-slot="context-menu-content"], [data-slot="context-menu-sub-content"]';
      // Escape first belongs to the open business overlay, even if it unmounts
      // before this window-level listener receives the same key event.
      if (modalOpenRef.current || (event.target instanceof Element && event.target.closest(childOverlay))
        || [...document.querySelectorAll<HTMLElement>(childOverlay)].some(isGuideTargetVisible)) return;
      onPause();
    };
    for (const type of ['input','click']) document.addEventListener(type, interact);
    window.addEventListener('keydown', escape);
    check();
    return () => { mutations.disconnect();
      for (const type of ['input','click']) document.removeEventListener(type, interact);
      window.removeEventListener('keydown', escape); };
  }, [step.id, targetSurfaceKey]);
  useEffect(() => {
    // Respect Radix focus trapping. Resume after the user closes the actual dialog.
    const check = () => {
      const current = [...document.querySelectorAll<HTMLElement>('[data-slot="dialog-content"], [data-slot="alert-dialog-content"]')]
        .find(isGuideTargetVisible) ?? null;
      setActiveModal(current);
      setModalOpen(Boolean(current));
    };
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList:true, subtree:true, attributes:true, attributeFilter:['data-state', 'hidden'] });
    check();
    return () => observer.disconnect();
  }, []);
  const actionObserved = !step.signal || signal || observed[step.signal] === true;
  const complete = !missing && (step.practiceOptional || actionObserved);
  const completeCount = progress.completed.length;
  const resolved = completeCount + progress.skipped.length;
  const waitingForTarget = !rect && !error && !missing && (!busy || step.id !== 'welcome');
  const [panelHeight, setPanelHeight] = useState(0);
  useLayoutEffect(() => {
    const element = panel.current;
    if (!element || modalOpen) return;
    // Measure the final instructions before paint, not the preceding loading notice.
    const measure = () => {
      // Measure the unclipped content, not the height imposed by the last placement.
      // Otherwise a short bottom band can make the panel jump back to the side,
      // expand there, and jump down again before the user's click lands.
      const body = instructions.current;
      const overflow = body ? Math.max(0, body.scrollHeight - body.clientHeight) : 0;
      setPanelHeight(element.offsetHeight + overflow);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element); measure();
    return () => observer.disconnect();
  }, [step.id, waitingForTarget, modalOpen]);
  const viewportWidth = rect?.viewportWidth ?? viewport.current?.clientWidth ?? window.innerWidth;
  const viewportHeight = rect?.viewportHeight ?? viewport.current?.clientHeight ?? window.innerHeight;
  const showCue = popupRects.length === 0;
  const obstacles = [...popupRects, ...(rect && relatedRect ? [relatedRect] : []), ...(showCue && cuePlacement ? [cuePlacement] : [])];
  const measuredPlacement = placeGuidePanel(rect, obstacles,
    panelHeight, viewportWidth, viewportHeight);
  // The five navigation cues move vertically. Keep their explanation panel anchored
  // on the far side so hovering an item never makes the entire panel jump.
  const placement = step.id === 'welcome' && viewportWidth >= 850
    ? { ...measuredPlacement, left: viewportWidth - measuredPlacement.width - 12, top: 12 }
    : measuredPlacement;
  const demoMode: PdfDemoMode | null = currentEntry?.fields?.tutorial_demo === 'attention-v1'
    && ['parsed', 'blocks', 'hover', 'selection-translation'].includes(step.id)
    ? step.id as PdfDemoMode : null;
  return <>{createPortal(<ViewportOverlay enabled layer="tooltip" interactive={false}><div ref={viewport} data-guide-overlay className="pointer-events-none absolute inset-0" style={modalOpen ? { display:'none' } : undefined}>
    <svg aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" width="100%" height="100%">
      <defs><mask id="neuink-guide-spotlight" maskUnits="userSpaceOnUse" x="0" y="0" width={viewportWidth} height={viewportHeight}><rect width="100%" height="100%" fill="white" />
        {rect && <rect data-guide-spotlight-window x={rect.x} y={rect.y} width={rect.width} height={rect.height} rx="4" fill="black" />}
        {rect && relatedRect && <rect data-guide-related-window x={relatedRect.x} y={relatedRect.y} width={relatedRect.width} height={relatedRect.height} rx="4" fill="black" />}
        {popupRects.map((popup, index) => <rect key={index} data-guide-popup-window x={popup.x} y={popup.y} width={popup.width} height={popup.height} rx="4" fill="black" />)}
      </mask></defs>
      <rect width="100%" height="100%" fill="var(--guide-backdrop)" mask="url(#neuink-guide-spotlight)" />
      {/* The shared mask removes every stroke inside the spotlight union, leaving only its outer contour. */}
      <g mask="url(#neuink-guide-spotlight)" fill="none" stroke="var(--primary)" strokeWidth="4">
        {rect && <rect x={rect.x} y={rect.y} width={rect.width} height={rect.height} rx="4" />}
        {rect && relatedRect && <rect x={relatedRect.x} y={relatedRect.y} width={relatedRect.width} height={relatedRect.height} rx="4" />}
        {popupRects.map((popup, index) => <rect key={index} x={popup.x} y={popup.y} width={popup.width} height={popup.height} rx="4" />)}
      </g>
      {showCue && cueRect && <rect data-guide-cue-outline x={cueRect.x} y={cueRect.y} width={cueRect.width} height={cueRect.height} rx="5" fill="none" stroke="var(--primary)" strokeWidth="3" />}
    </svg>
    <GuideInteractionShield width={viewportWidth} height={viewportHeight}
      windows={[...(rect ? [rect] : []), ...(rect && relatedRect ? [relatedRect] : []), ...popupRects]} />
    {showCue && cuePlacement && <div data-guide-target-cue aria-hidden="true" className="pointer-events-none absolute flex items-center gap-1.5 rounded-md border border-primary bg-primary px-2 text-[11px] font-medium text-primary-foreground shadow-md"
      style={{ left:cuePlacement.x, top:cuePlacement.y, width:cuePlacement.width, height:cuePlacement.height }}>
      {step.instructionCues && <span className="grid size-4 shrink-0 place-items-center rounded-sm bg-primary-foreground/20 tabular-nums">{focusedInstruction + 1}</span>}
      <span className="truncate">{cue?.label}</span>
    </div>}
    {rect && demoMode ? <GuidePdfDemonstration key={`${step.id}:${targetSurfaceKey}`} mode={demoMode} viewport={viewport}
      surfaceKey={targetSurfaceKey} /> : null}
    <section ref={panel} role="dialog" aria-modal="false" aria-labelledby="guide-title" tabIndex={-1} className="pointer-events-auto absolute flex min-h-0 max-h-[calc(100%_-_24px)] flex-col overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-lg"
      style={placement}>
      {waitingForTarget ? <div className="space-y-3 px-4 py-3">
        <p role="status" className="text-[13px] text-muted-foreground">{busy ? '正在准备本地演示资料…' : '正在加载本步页面，准备好后显示引导…'}</p>
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onPause}><Pause aria-hidden="true" />暂停引导</Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => { save(resolveStep(progress, true)); if (index === GUIDE_STEPS.length - 1) onClose(); }}>跳过本步</Button>
        </div>
      </div> : <>
      <header className="shrink-0 border-b px-4 py-3">
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground"><span>新手引导 · {step.task}</span><Button size="xs" variant="ghost" onClick={onPause}><Pause aria-hidden="true" />暂停引导</Button></div>
        <h2 id="guide-title" className="mt-1 text-sm font-semibold">{index + 1}. {step.title}</h2>
        <progress aria-label="新手教程总进度" value={resolved} max={GUIDE_STEPS.length} className="mt-2 h-1.5 w-full accent-primary" />
        <p className="mt-1 text-xs text-muted-foreground">{completeCount} 步完成 · {progress.skipped.length} 步跳过 · 共 {GUIDE_STEPS.length} 步</p>
      </header>
      <div ref={instructions} className="min-h-0 overflow-y-auto overscroll-contain px-4 py-3 text-[13px] leading-6">
        <div data-guide-step-action className="mb-3 rounded-md border border-primary/25 bg-primary/5 px-3 py-2.5 text-xs leading-5">
          <p className="font-medium text-foreground">这一步：{GUIDE_ACTIONS[step.id]?.action}</p>
          <p className="mt-1 text-muted-foreground">对应效果：{GUIDE_ACTIONS[step.id]?.result}</p>
        </div>
        {step.instructionCues ? <ol aria-label={step.id === 'welcome' ? '左侧导航入口' : '本步界面说明'} className="space-y-1.5">
          {step.instructions.map((text, itemIndex) => <li key={text}><button type="button" aria-current={focusedInstruction === itemIndex ? 'true' : undefined}
            className={'flex w-full items-start gap-2 rounded-md border px-2 py-1.5 text-left leading-5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring motion-reduce:transition-none ' + (focusedInstruction === itemIndex ? 'border-primary bg-primary/10' : 'border-transparent hover:bg-accent')}
            onMouseEnter={() => focusInstruction(itemIndex)} onFocus={() => focusInstruction(itemIndex)} onClick={() => focusInstruction(itemIndex)}>
            <span className={'mt-0.5 grid size-4 shrink-0 place-items-center rounded-sm text-[10px] tabular-nums ' + (focusedInstruction === itemIndex ? 'bg-primary text-primary-foreground' : 'border text-muted-foreground')}>{itemIndex + 1}</span>
            <span>{text}</span>
          </button></li>)}
        </ol> : <ol className="list-decimal space-y-2 pl-4">{step.instructions.map(text => <li key={text}>{text}</li>)}</ol>}
        {missing && <p className="mt-3 text-warning" role="status">{missing}</p>}
        {!rect && !error && <p className="mt-3 text-muted-foreground" role="status">{busy ? '正在准备示例论文，完成后自动打开。' : '已切换到本步页面；操作区域加载后会自动聚焦。若缺少论文或解析结果，可重试准备示例或跳过本步。'}</p>}
        {error && <p className="mt-3 text-destructive" role="alert">{error}</p>}
        {step.signal && <p className="mt-3 text-xs text-muted-foreground" role="status">{step.practiceOptional
          ? actionObserved ? '已体验本步交互；实际保存、发送或任务结果仍以页面反馈为准。'
            : '本步练习可选；直接继续只完成教程说明，不会自动执行写入或模型请求。'
          : complete ? '已检测到本步要求的操作，可继续。' : '等待你按步骤操作；暂时无法操作时可以跳过。'}</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          {busy && <p role="status" className="text-xs text-muted-foreground">正在准备本地演示资料…</p>}
          {error && <Button size="sm" variant="outline" disabled={busy || !props.ready || !props.root} onClick={onSample}>重试准备示例</Button>}
        </div>
        <details className="group/guide-tasks mt-4 rounded-md border bg-muted/30"><summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden"><ListChecks className="size-4 text-primary" aria-hidden="true" /><span className="flex-1">任务目录</span><span className="font-normal text-muted-foreground">{resolved}/{GUIDE_STEPS.length}</span><ChevronDown className="size-3.5 transition-transform group-open/guide-tasks:rotate-180 motion-reduce:transition-none" aria-hidden="true" /></summary>
          <nav aria-label="新手引导任务目录" className="border-t px-2 pb-2">
          {GUIDE_TASKS.map((task, taskIndex) => <div key={task} className="mt-3"><p className="mb-1 flex items-center gap-2 px-1 text-xs font-medium"><span className="grid size-5 shrink-0 place-items-center rounded border bg-background text-muted-foreground">{taskIndex + 1}</span><span className="flex-1">{task}</span><span className="text-[11px] font-normal tabular-nums text-muted-foreground">{GUIDE_STEPS.filter(item => item.task === task && progress.completed.includes(item.id)).length}/{GUIDE_STEPS.filter(item => item.task === task).length}</span></p>
            {GUIDE_STEPS.filter(item => item.task === task).map(item => {
              const done = progress.completed.includes(item.id); const skipped = progress.skipped.includes(item.id);
              const StatusIcon = done ? Check : skipped ? SkipForward : Circle;
              return <button key={item.id} type="button" disabled={busy}
              aria-current={item.id === step.id ? 'step' : undefined} className={'flex w-full items-start gap-2 rounded border-l-2 px-2 py-1.5 text-left text-xs leading-5 hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50 ' + (item.id === step.id ? 'border-primary bg-accent font-medium' : 'border-transparent')}
              onClick={event => { save({ ...progress, current:item.id }); const details = event.currentTarget.closest('details'); if (details) details.open = false; }}><StatusIcon className={'mt-1 size-3 shrink-0 ' + (done ? 'text-success' : 'text-muted-foreground')} aria-hidden="true" /><span className="flex-1">{item.title}</span><span className="shrink-0 text-[11px] font-normal text-muted-foreground">{done ? '已完成' : skipped ? '已跳过' : '待学习'}</span></button>;
            })}</div>)}
          </nav>
        </details>
      </div>
      <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t px-4 py-3">
        <Button size="sm" variant="ghost" disabled={busy || index === 0} onClick={() => save({ ...progress, current:GUIDE_STEPS[index-1].id })}>上一步</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => { save(resolveStep(progress, true)); if (index === GUIDE_STEPS.length - 1) onClose(); }}>跳过本步</Button>
        <Button size="sm" disabled={!complete || busy || Boolean(error) || !props.ready || !props.root} onClick={() => { save(resolveStep({ ...progress, entryId:currentEntry?.id ?? progress.entryId, root:currentEntry ? props.root : progress.root }, false)); if (index === GUIDE_STEPS.length - 1) onClose(); }}>{index === GUIDE_STEPS.length - 1 ? '结束引导' : step.signal ? '完成并继续' : '已了解，继续'}</Button>
      </footer>
      </>}
    </section>
  </div></ViewportOverlay>, document.body)}
    {modalOpen && activeModal && createPortal(<div data-guide-modal-reminder role="status"
      className="order-[-1] rounded-md border border-primary/25 bg-primary/5 px-3 py-2 text-xs text-foreground">
      新手引导第 {index + 1} 步仍在进行。关闭当前窗口后返回本步；不会退出或重置进度。
    </div>, activeModal)}
  </>;
}
