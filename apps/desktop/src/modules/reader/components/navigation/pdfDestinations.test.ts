import { describe, expect, it, vi } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { readNativePdfLinks, resolvePdfDestination } from './pdfDestinations';
function fixture() {
  const viewport = { width: 600, height: 800, convertToViewportPoint: (x: number,y: number) => [x,800-y],
    convertToViewportRectangle: (rect: number[]) => [rect[0],800-rect[1],rect[2],800-rect[3]] };
  const page = { view: [0,0,600,800], getViewport: () => viewport, getAnnotations: vi.fn().mockResolvedValue([
    { id: 'internal', subtype: 'Link', dest: 'section', rect: [60,720,120,740] },
    { id: 'external', subtype: 'Link', url: 'https://example.com', rect: [0,0,10,10] }
  ]) };
  const document = { numPages: 3, getPage: vi.fn().mockResolvedValue(page), getPageIndex: vi.fn().mockResolvedValue(1),
    getDestination: vi.fn().mockResolvedValue([{num: 7, gen: 0},{name:'XYZ'},60,640,null]) };
  return { document, pdf: document as unknown as PDFDocumentProxy };
}
describe('PDF destinations', () => {
  it('converts PDF coordinates and only exposes actual internal links', async () => {
    const {pdf} = fixture(); const links = await readNativePdfLinks(pdf, 0);
    expect(links).toHaveLength(1); expect(links[0].rect).toEqual([.1,.075,.2,.1]);
  });
  it('resolves named destinations once, including page references and offsets', async () => {
    const {pdf,document} = fixture();
    const [a,b] = await Promise.all([resolvePdfDestination(pdf,'section'),resolvePdfDestination(pdf,'section')]);
    expect(a).toEqual({pageIdx:1,rect:[100,200,120,220]}); expect(a).toBe(b); expect(document.getDestination).toHaveBeenCalledTimes(1);
  });
  it('uses page-only destinations without manufacturing a text position', async () => {
    const {pdf}=fixture(); expect(await resolvePdfDestination(pdf,[2,{name:'Fit'}])).toEqual({pageIdx:2});
  });
  it('keeps an unspecified horizontal destination as a strip instead of selecting the left column', async () => {
    const { pdf } = fixture();
    expect(await resolvePdfDestination(pdf, [1, { name: 'FitH' }, 640])).toEqual({ pageIdx: 1, rect: [0, 200, 1000, 220] });
    expect(await resolvePdfDestination(pdf, [1, { name: 'XYZ' }, null, 640, null])).toEqual({ pageIdx: 1, rect: [0, 200, 1000, 220] });
  });
  it('rejects invalid destinations and allows retry after a failure', async () => {
    const {pdf,document}=fixture(); document.getDestination.mockResolvedValueOnce(null);
    await expect(resolvePdfDestination(pdf,'section')).rejects.toThrow('没有可用');
    await expect(resolvePdfDestination(pdf,'section')).resolves.toMatchObject({pageIdx:1});
    await expect(resolvePdfDestination(pdf,[9,{name:'Fit'}])).rejects.toThrow('页码无效');
  });
});
