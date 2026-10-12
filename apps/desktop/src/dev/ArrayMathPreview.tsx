import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { SourceSnapshotPreview } from '@/shared/components/SourceSnapshotPreview';

const reportedMatrix = String.raw`S=\left[ \begin{array}{c\_{c} c} 0 & S\_{1 2} & S\_{1 3} & \dots & S\_{1 N} \\\S\_{2 1} & 0 & S\_{2 3} & \dots & S\_{2 N} \\\S\_{3 1} & S\_{3 2} & 0 & \dots & S\_{3 N} \\\ \dots & \dots & \dots & \dots & \dots \\\S\_{N 1} & S\_{N 2} & S\_{N 3} & \dots & 0 \end{array} \right]\tag{5}`;

/** Read-only rendering fixtures; no workspace or model calls. */
export function ArrayMathPreview() {
  const [source, setSource] = useState(reportedMatrix);
  const [narrow, setNarrow] = useState(false);
  const [scale, setScale] = useState(1);
  return <main className="min-h-screen bg-background p-4 text-foreground">
    <header className="mb-4 flex flex-wrap items-center gap-2 text-sm">
      <span className="mr-auto">矩阵公式显示检查</span>
      <Button size="sm" onClick={() => setNarrow(!narrow)}>{narrow ? '宽面板' : '360px 面板'}</Button>
      <Button size="sm" onClick={() => setScale(scale === 1 ? 1.25 : 1)}>{scale === 1 ? '125%' : '100%'}</Button>
    </header>
    <div className="mx-auto max-w-full border bg-card" style={{ width: narrow ? 360 : 720, zoom: scale }}>
      <section className="p-4" aria-label="原文公式">
        <h2 className="mb-3 text-sm font-semibold">原文</h2>
        <SourceSnapshotPreview allowScroll={false} markdown={source} segmentType="math" />
      </section>
      <section className="border-t p-4" aria-label="译文公式">
        <h2 className="mb-3 text-sm font-semibold">翻译</h2>
        <SourceSnapshotPreview allowScroll={false} markdown={'$$' + source + '$$'} segmentType="paragraph" />
      </section>
    </div>
    <details className="mx-auto mt-4 max-w-[720px] text-sm">
      <summary>检查公式源码</summary>
      <Textarea className="mt-2 min-h-32" aria-label="公式源码" value={source} onChange={event => setSource(event.target.value)} />
    </details>
  </main>;
}
