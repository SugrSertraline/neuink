import '@/styles/book-volume.css';
import { forwardRef, type CSSProperties } from 'react';
import { bookTone } from './bookTone';

/** Live DOM faces: title, cloth, gilding and page edges stay crisp at every size. */
export const BookVolume = forwardRef<HTMLDivElement, {
  id: string; title: string; topic: string; open?: boolean; bookmark?: boolean;
  className?: string; style?: CSSProperties;
}>(function BookVolume({ id, title, topic, open = false, bookmark, className = '', style }, ref) {
  return <div ref={ref} className={`library-book book-volume ${className}`} data-cover-tone={bookTone(id)} data-open={open} style={style} aria-hidden="true">
    <div className="book-volume-body">
      <span className="library-book-face library-book-back" />
      <span className="library-book-face library-book-spine"><span>{title}</span></span>
      <span className="library-book-face library-book-pages" />
      <span className="library-book-face library-book-top" />
      <span className="library-book-face library-book-bottom" />
      <div className="book-volume-first-page"><span>{title}</span><small>{topic}</small></div>
      <div className="book-volume-front">
        <div className="library-book-cover">
          <span className="library-book-kicker">NEUINK / RESEARCH</span>
          <span className="library-book-title">{title}</span>
          <span className="library-book-motif" />
          <span className="library-book-topic">{topic}</span>
        </div>
        <div className="book-volume-inside" />
        {bookmark && <span className="library-bookmark" />}
      </div>
    </div>
  </div>;
});
