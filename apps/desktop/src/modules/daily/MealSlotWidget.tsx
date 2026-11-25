import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Shuffle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { chooseMeal } from './dailyLifestyle';
import './dailyLifestyle.css';

export function MealSlotWidget({ active, date, meals, selected, onPick, onSettings, kind = 'meal', controls, scope = 'meal' }: {
  active: boolean; date: string; meals: string[]; selected: string;
  onPick: (meal: string) => void; onSettings: () => void;
  kind?: 'meal' | 'drink'; controls?: ReactNode; scope?: string;
}) {
  const title = kind === 'drink' ? '今天喝什么' : '今天吃什么';
  const resultLabel = kind === 'drink' ? '今天就喝' : '今天就吃';
  const buttonLabel = kind === 'drink' ? '帮我选一杯' : '帮我选一顿';
  const track = useRef<HTMLDivElement>(null);
  const [pendingSpin, setSpin] = useState<{ rows: string[]; target: string; meals: string[]; date: string; scope: string } | null>(null);
  const spin = pendingSpin?.meals === meals && pendingSpin.date === date && pendingSpin.scope === scope ? pendingSpin : null;
  const pick = useRef(onPick); pick.current = onPick;
  const busy = useRef(false);
  const current = meals.includes(selected) ? selected : '';
  useEffect(() => { busy.current = false; setSpin(null); }, [date, meals, active, scope]);
  useEffect(() => {
    const element = track.current;
    if (!spin || !active || !element) return;
    let cancelled = false;
    const finish = () => {
      if (cancelled) return;
      cancelled = true; busy.current = false;
      pick.current(spin.target); setSpin(null);
    };
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (media.matches || typeof element.animate !== 'function') { finish(); return; }
    const animation = element.animate([{ transform: 'translateY(0)' }, { transform: `translateY(-${(spin.rows.length - 3) * 32}px)` }],
      { duration: 1800, easing: 'cubic-bezier(.12,.7,.1,1)', fill: 'forwards' });
    void animation.finished.then(finish, () => {});
    const reduced = () => { if (media.matches) { finish(); animation.cancel(); } };
    const hidden = () => { if (document.hidden) { cancelled = true; busy.current = false; animation.cancel(); setSpin(null); } };
    media.addEventListener('change', reduced); document.addEventListener('visibilitychange', hidden);
    return () => { cancelled = true; animation.cancel(); media.removeEventListener('change', reduced); document.removeEventListener('visibilitychange', hidden); };
  }, [spin, active]);
  const start = () => {
    if (!active || busy.current || !meals.length) return;
    const target = chooseMeal(meals, current);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { pick.current(target); return; }
    busy.current = true;
    const startIndex = Math.max(0, meals.indexOf(current));
    const rows = Array.from({ length: 24 }, (_, index) => meals[(startIndex + index + meals.length - 1) % meals.length]);
    rows.push(target, meals[(meals.indexOf(target) + 1) % meals.length]);
    setSpin({ rows, target, meals, date, scope });
  };
  const rows = spin?.rows ?? (meals.length ? [meals[(Math.max(0, meals.indexOf(current)) + meals.length - 1) % meals.length], current || `${title}？`, meals[(Math.max(0, meals.indexOf(current)) + 1) % meals.length]] : []);
  return <section aria-label={title} className="meal-picker space-y-2 border-b border-border py-3 text-xs">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-medium">{title}</h3><Button size="xs" variant="link" className="h-auto px-0" onClick={onSettings}>编辑菜单</Button></div>
    {controls}
    {meals.length ? <>
      <div className="meal-machine" data-spinning={Boolean(spin)}>
        <div className="meal-reel" aria-hidden="true"><div ref={track} className="meal-reel-track">{rows.map((meal, index) => <div key={index} className="meal-reel-item" data-center={!spin && index === 1} title={meal}>{meal}</div>)}</div></div>
        <Button className="self-center px-5" size="sm" variant="outline" aria-label={`转一转，决定${title}`} disabled={Boolean(spin) || !active} onClick={start}>
          <Shuffle size={14} aria-hidden="true" />{spin ? '正在挑选…' : current ? '换一个选择' : buttonLabel}
        </Button>
      </div>
      <p role="status" className="min-h-4 break-words text-center text-muted-foreground">{spin ? '正在挑选…' : current ? `${resultLabel}：${current}` : `从本类 ${meals.length} 个选项中随机挑一个`}</p>
    </> : <p className="text-muted-foreground">本类菜单还是空的，点击“编辑菜单”添加候选项。</p>}
  </section>;
}
