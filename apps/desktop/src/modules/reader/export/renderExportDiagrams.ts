import type { ExportDiagram, RenderedExportDiagram } from '@/shared/ipc/exportApi';
import { renderMermaidSvg } from '@/shared/lib/mermaidRenderer';

export async function renderExportDiagrams(diagrams: ExportDiagram[], progress: (text: string) => void) {
  const images: RenderedExportDiagram[] = [];
  let total = 0;
  for (const [index, diagram] of diagrams.entries()) {
    progress(`正在渲染流程图 ${index + 1} / ${diagrams.length}…`);
    try {
      const svg = await renderMermaidSvg(`export-${diagram.id}-${Date.now()}`, diagram.code, true);
      const png = await svgToPng(svg);
      total += png.length;
      if (total > 96 * 1024 * 1024) throw new Error('渲染图片总量过大');
      images.push({ id: diagram.id, png_base64: png });
    } catch {
      // Do not expose a parser error containing arbitrary paper text, or silently "repair" scientific diagrams.
      throw new Error(`第 ${diagram.page} 页流程图 ${index + 1} 无法安全渲染。未导出文件，请改选原图或 Mermaid 源码。`);
    }
  }
  return images;
}

export function rasterDimensions(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error('流程图尺寸无效');
  const scale = Math.min(2, 4096 / width, 4096 / height, Math.sqrt(12_000_000 / (width * height)));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

async function svgToPng(markup: string): Promise<string> {
  const parsed = new DOMParser().parseFromString(markup, 'image/svg+xml');
  if (parsed.querySelector('parsererror, foreignObject, script, image')) throw new Error('流程图包含不支持的元素');
  const svg = parsed.documentElement;
  const box = svg.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
  if (!box || box.length !== 4) throw new Error('流程图没有有效尺寸');
  const size = rasterDimensions(box[2], box[3]);
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  svg.setAttribute('width', String(size.width));
  svg.setAttribute('height', String(size.height));
  svg.removeAttribute('style');
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml;charset=utf-8' }));
  const image = new Image();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      timeout = setTimeout(() => reject(new Error('流程图加载超时')), 15_000);
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('流程图无法转换'));
      image.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('图片画布不可用');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, size.width, size.height);
    context.drawImage(image, 0, 0, size.width, size.height);
    return canvas.toDataURL('image/png').split(',')[1];
  } finally {
    clearTimeout(timeout);
    image.onload = null;
    image.onerror = null;
    image.src = '';
    URL.revokeObjectURL(url);
  }
}
