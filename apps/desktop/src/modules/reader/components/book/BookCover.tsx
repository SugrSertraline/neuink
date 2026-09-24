import { useRef } from 'react';
import { useBookStage } from './useBookStage';

export function BookCover({ id, title, topic, bookmark = false, enabled = true, mode = 'shelf' }: {
  id: string; title: string; topic: string; bookmark?: boolean; enabled?: boolean; mode?: 'shelf' | 'overview';
}) {
  const ref = useRef<HTMLDivElement>(null);
  const tone = [...id].reduce((sum, character) => (sum * 31 + character.charCodeAt(0)) >>> 0, 0) % 6;
  useBookStage(ref, { title, topic, bookmark }, enabled, mode);
  return <div ref={ref} className="library-book" data-cover-tone={tone} data-book-mode={mode} title={title} aria-hidden="true">
    <div className="book-cover-fallback">
      {mode === 'shelf' ? <>
        <span className="library-book-face library-book-back"/>
        <span className="library-book-face library-book-spine"/>
        <span className="library-book-face library-book-pages"/>
        <span className="library-book-face library-book-top"/>
        <span className="library-book-face library-book-bottom"/>
      </> : null}
      {bookmark ? <span className="library-bookmark"/> : null}
      <div className="library-book-cover">
        <span className="library-book-kicker">NEUINK / RESEARCH</span>
        <span className="library-book-title">{title}</span>
        <span className="library-book-motif"/>
        <span className="library-book-topic">{topic}</span>
      </div>
    </div>
  </div>;
}
