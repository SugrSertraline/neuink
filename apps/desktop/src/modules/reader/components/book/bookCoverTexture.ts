export type BookPalette = { cover: string; ink: string; paper: string; edge: string };
export type BookContent = { title: string; topic: string; bookmark: boolean };

/** Wraps both CJK and long identifiers without depending on whitespace. */
export function wrapCoverText(text: string, maxWidth: number, measure: (text: string) => number) {
  const lines: string[] = [];
  let line = '';
  for (const word of text.trim().split(/(\s+)/u)) {
    if (line && measure(line + word) > maxWidth) { lines.push(line.trim()); line = ''; }
    for (const character of word) {
      if (line && measure(line + character) > maxWidth) { lines.push(line.trim()); line = ''; }
      line += character;
    }
  }
  if (line.trim()) lines.push(line.trim());
  return lines;
}

export function paintBookCover(content: BookContent, palette: BookPalette) {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 768;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Book cover canvas unavailable');
  context.fillStyle = palette.cover; context.fillRect(0, 0, 512, 768);
  // Deterministic woven fibres: no external assets, network or document pixels.
  context.fillStyle = palette.ink; context.globalAlpha = .045;
  for (let x = 0; x < 512; x += 4) context.fillRect(x, 0, 1, 768);
  for (let y = 0; y < 768; y += 5) context.fillRect(0, y, 512, 1);
  context.globalAlpha = .4; context.strokeStyle = palette.ink; context.lineWidth = 1;
  context.strokeRect(38, 28, 447, 710);
  context.beginPath(); context.moveTo(24, 0); context.lineTo(24, 768); context.stroke();
  context.globalAlpha = .8; context.font = '16px Georgia, serif';
  context.fillText('NEUINK  /  RESEARCH', 57, 69);
  let size = 43, lines: string[] = [];
  do {
    context.font = `500 ${size}px Georgia, "Microsoft YaHei", serif`;
    lines = wrapCoverText(content.title, 375, value => context.measureText(value).width);
    if (lines.length * size * 1.23 <= 420 || size <= 24) break;
    size -= 2;
  } while (size > 0);
  context.globalAlpha = 1;
  const visibleLines = lines.slice(0, Math.floor(420 / (size * 1.23)));
  visibleLines.forEach((line, index) => {
    const clipped = index === visibleLines.length - 1 && visibleLines.length < lines.length;
    context.fillText(clipped ? `${line.slice(0, -2)}…` : line, 57, 145 + index * size * 1.23);
  });
  context.globalAlpha = .45; context.beginPath();
  context.moveTo(57, 629); context.lineTo(190, 629); context.stroke();
  context.globalAlpha = .9; context.font = '21px "Microsoft YaHei", sans-serif';
  const topic = wrapCoverText(content.topic, 375, value => context.measureText(value).width)[0] || '';
  context.fillText(topic, 57, 684);
  return canvas;
}

export function paintPageEdges(palette: BookPalette) {
  const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 256;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Book page canvas unavailable');
  context.fillStyle = palette.paper; context.fillRect(0, 0, 64, 256);
  context.fillStyle = palette.edge; context.globalAlpha = .22;
  for (let y = 0; y < 256; y += 3) context.fillRect(0, y, 64, 1);
  return canvas;
}
