import { useMemo } from 'react';
import { buildDailyCalendar } from './dailyCalendarModel';

export default function DailyCalendar({ date }: { date: string }) {
  const calendar = useMemo(() => buildDailyCalendar(date), [date]);
  if (!calendar) return <p role="status" className="mt-3 text-xs text-muted-foreground">暂时无法显示这一天的黄历。</p>;
  return <section aria-label="今日节令与黄历" className="mt-3 rounded-md bg-muted/50 px-3 py-2.5 text-xs leading-relaxed">
    <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
      <span className="font-medium">农历{calendar.lunarDate}</span>
      {calendar.festivals.length ? <span className="text-primary">{calendar.festivals.join(' · ')}</span> : null}
    </div>
    <p className="mt-1 text-[11px] text-muted-foreground">{calendar.nextTerm.days === 0 ? `今天交节 · ${calendar.nextTerm.name}` : `距${calendar.nextTerm.name}还有 ${calendar.nextTerm.days} 天 · ${calendar.nextTerm.date.slice(5).replace('-', '月')}日`}</p>
    <dl className="mt-2 space-y-1">
      <AlmanacRow label="宜" items={calendar.suitable} />
      <AlmanacRow label="忌" items={calendar.avoid} />
    </dl>
    <p className="mt-2 text-[10px] text-muted-foreground">传统黄历 · 趣味参考</p>
  </section>;
}

function AlmanacRow({ label, items }: { label: string; items: string[] }) {
  return <div className="flex items-start gap-2">
    <dt className={`shrink-0 font-medium ${label === '宜' ? 'text-success' : 'text-muted-foreground'}`}>{label}</dt>
    <dd className="min-w-0 break-words" title={items.join('、')}>{items.slice(0, 4).join(' · ') || '无'}{items.length > 4 ? ' 等' : ''}</dd>
  </div>;
}
