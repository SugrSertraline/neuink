// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { PdfZoomControls } from './PdfZoomControls';
import { usePdfReaderZoom } from './usePdfReaderZoom';
import { PDF_ZOOM_STEP } from './readerConstants';

afterEach(() => { cleanup(); localStorage.clear(); });
function Harness() {
  const { zoom, updateZoom } = usePdfReaderZoom({ entryId: 'zoom-test', viewportWidth: 600, pageDisplayMode: 'single', onInteractionStart: () => {} });
  return <PdfZoomControls zoom={zoom} onZoomIn={() => updateZoom(v => v + PDF_ZOOM_STEP)}
    onZoomOut={() => updateZoom(v => v - PDF_ZOOM_STEP)} onZoomReset={() => updateZoom(() => 1)} />;
}
it('adjusts by one percent, resets to 100% and persists the actual value', () => {
  const ui = render(<Harness />);
  fireEvent.click(ui.getByRole('button', { name: '放大' }));
  expect(ui.getByRole('button', { name: '恢复 100%' }).textContent).toBe('101%');
  fireEvent.click(ui.getByRole('button', { name: '缩小' }));
  fireEvent.click(ui.getByRole('button', { name: '缩小' }));
  expect(ui.getByRole('button', { name: '恢复 100%' }).textContent).toBe('99%');
  fireEvent.click(ui.getByRole('button', { name: '恢复 100%' }));
  expect(ui.getByRole('button', { name: '恢复 100%' }).textContent).toBe('100%');
  expect(localStorage.getItem('neuink.reader.pdfZoom.zoom-test')).toBe('1');
});
it.each([['0.1', '缩小'], ['3', '放大']])('disables the limit at %s and keeps reset available', (value, label) => {
  localStorage.setItem('neuink.reader.pdfZoom.zoom-test', value);
  const ui = render(<Harness />);
  expect((ui.getByRole('button', { name: label }) as HTMLButtonElement).disabled).toBe(true);
  act(() => { (ui.getByRole('button', { name: '恢复 100%' }) as HTMLButtonElement).click(); });
  expect(ui.getByRole('button', { name: '恢复 100%' }).textContent).toBe('100%');
});
