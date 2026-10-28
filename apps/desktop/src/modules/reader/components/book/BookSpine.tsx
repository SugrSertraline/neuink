import type { CSSProperties } from 'react';
import { bookTone } from './bookTone';
import { BookVolume } from './BookVolume';

export function BookSpine({ id, title, topic, progress }: { id: string; title: string; topic: string; progress: string }) {
  const tone = bookTone(id);
  return <div className="library-book-standing" title={`${title}\n${topic} · ${progress}`} style={{
    '--spine-height': `${214 + tone * 4}px`, '--atelier-book-depth': `${36 + tone * 2}px`,
  } as CSSProperties}>
    <BookVolume id={id} title={title} topic={topic} bookmark={progress !== '未开始阅读'} />
  </div>;
}
