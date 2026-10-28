import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AppearanceProvider, useAppearance } from '@/shared/components/AppearanceProvider';
import { BookOpeningProvider, useBookOpening } from '@/modules/reader/components/book/BookOpeningProvider';
import { BookVolume } from '@/modules/reader/components/book/BookVolume';
import { BookSpine } from '@/modules/reader/components/book/BookSpine';
import { createSoftPageTurn } from '@/modules/reader/components/book/softPageTurnScene';
import '../styles/globals.css';

const titles = ['A Multi-Level Sentiment Analysis Framework for Financial Texts', 'Shift-Left Requirements Verification', 'Bridging the Gap between User Intent and LLM', 'Automatic Generation of Logical Specifications', '需求分析与跨论文阅读', 'Attention Is All You Need'];
function Curl({ progress }: { progress: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const front = document.createElement('canvas'); front.width = 600; front.height = 800;
    const context = front.getContext('2d')!; context.fillStyle = '#fffdf7'; context.fillRect(0, 0, 600, 800);
    context.fillStyle = '#34302a'; context.font = 'bold 30px Georgia'; context.fillText('A Research Paper', 40, 60);
    context.font = '17px Georgia';
    for (let line = 0; line < 26; line++) context.fillText('Reading and understanding research through evidence.', 40, 105 + line * 23);
    const back = document.createElement('canvas'); back.width = 600; back.height = 800;
    const c = back.getContext('2d')!; c.fillStyle = '#faf7ef'; c.fillRect(0, 0, 600, 800); c.fillStyle = '#34302a'; c.font = '24px Georgia'; c.fillText('2. Related Work', 40, 60);
    const scene = createSoftPageTurn(ref.current!, { width: 180, height: 240, direction: 1, front, back }); scene.draw(progress);
    return () => { scene.dispose(); front.width = back.width = 0; };
  }, [progress]);
  return <div style={{ width: 360, height: 265, position: 'relative', background: 'var(--reader-desk)' }}>
    <div ref={ref} style={{ position: 'absolute', width: 180, height: 240, left: 180, top: 5 }} />
    <span style={{ position: 'absolute', bottom: 0, fontSize: 11 }}>卷页 {Math.round(progress * 100)}%</span>
  </div>;
}
function Preview() {
  const { setAppearance } = useAppearance(); const begin = useBookOpening();
  const [opened, setOpened] = useState('');
  useLayoutEffect(() => { setAppearance('atelier'); }, [setAppearance]);
  return <main style={{ padding: 24, background: 'var(--background)', height: '100%', overflow: 'auto' }}>
    <h1>取书、实时封面和右下角卷页检查</h1><p role="status">{opened ? `已打开 Tab：${opened}` : '点击书脊检查完整过渡；这里只使用演示数据。'}</p>
    <div className="library-paper-shelf" data-display="spines" style={{ height: 282, flex: 'none' }}><div className="library-shelf-rows"><div className="library-shelf-row" style={{ height: 282, gridTemplateColumns: 'repeat(18, 54px)' }}>
      {Array.from({ length: 18 }, (_, i) => <div className="library-shelf-entry" key={i} data-book-index={i} tabIndex={0}
        onClick={event => begin({ id: `book-${i}`, title: titles[i % 6], tags: ['研究札记'] }, event.currentTarget.querySelector('.library-book-standing')!, () => setOpened(titles[i % 6]))}>
        <BookSpine id={`book-${i}`} title={titles[i % 6]} topic="研究札记" progress="未开始阅读" />
      </div>)}
    </div></div></div>
    <div style={{ display: 'flex', gap: 30, padding: '25px 0', alignItems: 'start' }}>
      <BookVolume id="book-0" title={titles[0]} topic="Financial research" />
      <Curl progress={.15} /><Curl progress={.48} />
    </div>
  </main>;
}
createRoot(document.getElementById('root')!).render(<AppearanceProvider><BookOpeningProvider><Preview /></BookOpeningProvider></AppearanceProvider>);
