import { ChartNoAxesColumnIncreasing } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import { buildReadingOverview, formatReadingDuration } from './libraryReading';

export function ReadingOverviewPopover({ overview }: { overview: ReturnType<typeof buildReadingOverview> }) {
  const maxDailyMs = Math.max(...overview.days.map((day) => day.activeMs), 1);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          aria-label="阅读统计"
          className="text-xs @max-[700px]/library-heading:w-8 @max-[700px]/library-heading:px-0"
          size="default"
          title={`查看当前范围的阅读统计；今日 ${formatReadingDuration(overview.todayMs)}`}
          type="button"
          variant="outline"
        >
          <ChartNoAxesColumnIncreasing size={14} aria-hidden="true" />
          <span className="@max-[700px]/library-heading:hidden">阅读统计</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        aria-label="阅读统计详情"
        className="w-80 max-w-[calc(100vw-2rem)]"
        viewportAligned
      >
        <PopoverHeader>
          <PopoverTitle>阅读统计</PopoverTitle>
          <PopoverDescription className="text-xs">按当前筛选和标签范围统计</PopoverDescription>
        </PopoverHeader>
        <dl className="grid grid-cols-2 border-y text-xs">
          <OverviewMetric label="今日阅读" value={formatReadingDuration(overview.todayMs)} />
          <OverviewMetric label="累计阅读" value={formatReadingDuration(overview.totalMs)} />
          <OverviewMetric label="阅读中" value={`${overview.inProgress} 篇`} />
          <OverviewMetric label="已读完" value={`${overview.completed} 篇`} />
        </dl>
        <div className="min-w-0">
          <div className="mb-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
            <span>最近 7 天</span>
            <span>{formatReadingDuration(overview.weekMs)}</span>
          </div>
          <div className="flex h-8 items-end gap-1" aria-label="最近 7 天阅读时长柱状图">
            {overview.days.map((day) => (
              <div className="flex h-full min-w-0 flex-1 items-end" key={day.date} title={`${day.label}：${formatReadingDuration(day.activeMs)}`}>
                <div
                  className="w-full rounded-sm bg-primary/70"
                  style={{ height: `${Math.max(day.activeMs > 0 ? 10 : 3, (day.activeMs / maxDailyMs) * 100)}%` }}
                />
              </div>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function OverviewMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-r px-2.5 py-2 even:border-r-0">
      <dt className="text-[10px] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
