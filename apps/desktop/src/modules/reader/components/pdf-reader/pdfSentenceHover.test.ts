// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { matchingSentenceOrder, pdfSentenceGeometry, sentenceAtPoint, translatedSentenceGeometry } from './pdfSentenceHover';
import type { SegmentRegionItem } from './types';

describe('PDF sentence hover', () => {
  it('matches source sentences to PDF text with ligatures and OCR differences', () => {
    const matched = matchingSentenceOrder(
      'Traffic ﬂow changes rapidly. The model predicts future traffic.',
      'Traﬃc flow changes rapidly. The model predicts future traffic.',
    );
    expect(matched?.sourceSentences).toHaveLength(2);
    expect(matched?.pdfSentences).toHaveLength(2);
  });

  it('does not claim a sentence match when boundaries or content differ', () => {
    expect(matchingSentenceOrder('First sentence. Second sentence.', 'First sentence and second sentence.')).toBeNull();
    expect(matchingSentenceOrder('Traffic flow changes.', 'Unrelated figure caption.')).toBeNull();
  });

  it('recovers PDF sentence boundaries without spaces and links a paragraph continued on another page', () => {
    const matched = matchingSentenceOrder(
      'Traffic patterns change across regions. Recently, models account for heterogeneity. The result improves prediction.',
      'Recently, models account for heterogeneity.The result improves prediction.',
    );
    expect(matched?.pdfSentences).toHaveLength(2);
    expect(matched?.sourceIndexes).toEqual([1, 2]);
  });

  it('hits the full line rectangle of a sentence', () => {
    const page = { left: 100, top: 200, width: 500, height: 1000 } as DOMRect;
    const sentences = [{ index: 1, source: 'Second.', linkedSentenceIndex: 1, rects: [[100, 200, 500, 220] as const] }];
    expect(sentenceAtPoint(sentences, page, 250, 410)?.index).toBe(1);
    expect(sentenceAtPoint(sentences, page, 250, 450)).toBeNull();
  });

  it('builds two selectable PDF sentence regions for one paragraph', () => {
    const layer = document.createElement('div');
    const lines = ['Traffic flow changes rapidly. ', 'The model predicts future traffic.'];
    lines.forEach((line, index) => {
      const span = document.createElement('span');
      span.textContent = line;
      span.getBoundingClientRect = () => ({ left: 20, top: 30 + index * 30, right: 360, bottom: 50 + index * 30,
        width: 340, height: 20 } as DOMRect);
      layer.append(span);
    });
    const region = { id: 'paragraph', bbox: [0, 0, 1000, 1000], sourceSegment: {
      segment_type: 'paragraph', text: lines.join(''),
    } } as unknown as SegmentRegionItem;
    const page = { left: 0, top: 0, right: 500, bottom: 500, width: 500, height: 500 } as DOMRect;
    Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value(this: Range) {
      return [this.startContainer.parentElement!.getBoundingClientRect()] as unknown as DOMRectList;
    } });
    try {
      const geometry = pdfSentenceGeometry(layer, region, page);
      expect(geometry).toHaveLength(2);
      expect(sentenceAtPoint(geometry!, page, 100, 40)?.index).toBe(0);
      expect(sentenceAtPoint(geometry!, page, 100, 70)?.index).toBe(1);
    } finally { delete (Range.prototype as { getClientRects?: () => DOMRectList }).getClientRects; }
  });

  it('highlights PDF sentences but does not link unrelated MinerU text', () => {
    const layer = document.createElement('div');
    const wrapper = document.createElement('span');
    for (const [index, line] of ['Traffic flow changes rapidly. ', 'The model predicts future traffic.'].entries()) {
      const span = document.createElement('span');
      span.textContent = line;
      span.getBoundingClientRect = () => new DOMRect(20, 30 + index * 30, 340, 20);
      wrapper.append(span);
    }
    layer.append(wrapper);
    const region = { id: 'paragraph', bbox: [0, 0, 1000, 1000], sourceSegment: {
      segment_type: 'paragraph', text: 'Road conditions vary quickly. Another algorithm predicts demand.',
    } } as unknown as SegmentRegionItem;
    const page = new DOMRect(0, 0, 500, 500);
    Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value(this: Range) {
      return [this.startContainer.parentElement!.getBoundingClientRect()] as unknown as DOMRectList;
    } });
    try {
      const geometry = pdfSentenceGeometry(layer, region, page);
      expect(geometry).toHaveLength(2);
      expect(geometry?.map(sentence => sentence.linkedSentenceIndex)).toEqual([null, null]);
      expect(sentenceAtPoint(geometry!, page, 100, 70)?.index).toBe(1);
    } finally { delete (Range.prototype as { getClientRects?: () => DOMRectList }).getClientRects; }
  });
  it('uses rendered Chinese sentence positions and maps each to its source sentence', () => {
    const layer = document.createElement('div');
    for (const [index, text] of ['交通流量变化迅速。', '模型预测未来流量。'].entries()) {
      const span = document.createElement('span');
      span.textContent = text;
      span.getBoundingClientRect = () => new DOMRect(140, 160 + index * 30, 150, 20);
      layer.append(span);
    }
    const region = { id: 'paragraph', bbox: [100, 100, 900, 900], sourceSegment: {
      segment_type: 'paragraph', text: 'Traffic flow changes rapidly. The model predicts future traffic.',
    } } as unknown as SegmentRegionItem;
    const page = new DOMRect(100, 100, 500, 500);
    Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value(this: Range) {
      return [this.startContainer.parentElement!.getBoundingClientRect()] as unknown as DOMRectList;
    } });
    try {
      const geometry = translatedSentenceGeometry(layer, region, page, '交通流量变化迅速。模型预测未来流量。');
      expect(geometry).toHaveLength(2);
      expect(sentenceAtPoint(geometry!, page, 160, 170)?.source).toBe('Traffic flow changes rapidly.');
      expect(sentenceAtPoint(geometry!, page, 160, 200)?.linkedSentenceIndex).toBe(1);
      expect(sentenceAtPoint(geometry!, page, 110, 110)).toBeNull();
      expect(translatedSentenceGeometry(layer, region, page, '文字不匹配。')).toBeNull();
    } finally { delete (Range.prototype as { getClientRects?: () => DOMRectList }).getClientRects; }
  });

  it('does not invent sentence positions when translation alignment fails', () => {
    const layer = document.createElement('div');
    layer.textContent = '仅有一个不匹配的数字 7。';
    const region = { bbox: [0, 0, 1000, 1000], sourceSegment: { segment_type: 'paragraph',
      text: 'The first result is 3. The second result is 4.' } } as unknown as SegmentRegionItem;
    expect(translatedSentenceGeometry(layer, region, new DOMRect(0, 0, 500, 500), layer.textContent)).toBeNull();
  });

});
