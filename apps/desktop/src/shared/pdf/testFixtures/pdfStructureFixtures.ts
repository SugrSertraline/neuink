/**
 * Test-only builders for small PDFs with specific cross-reference layouts.
 * Each builder writes a complete, consistent file unless a test damages it on purpose.
 */
import { deflateSync } from 'node:zlib';

/** Builds a classic-xref PDF from object bodies; body i is object number i + 1. */
export function classicPdf(bodies: string[], options: { root?: number; trailerExtra?: string } = {}): Uint8Array {
  const root = options.root ?? 1;
  let text = '%PDF-1.4\n';
  const offsets: number[] = [];
  bodies.forEach((body, index) => {
    offsets.push(text.length);
    text += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefOffset = text.length;
  text += `xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n`;
  text += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  text += `trailer\n<< /Size ${bodies.length + 1} /Root ${root} 0 R ${options.trailerExtra ?? ''} >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(text);
}

/** Standard page-tree objects for a one-catalog document with the given page bodies. */
export function pageTreeBodies(pageBodies: string[]): string[] {
  const kids = pageBodies.map((_, index) => `${index + 3} 0 R`).join(' ');
  return [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${kids}] /Count ${pageBodies.length} >>`,
    ...pageBodies
  ];
}

/**
 * Writes objects 1..N. Numbers in `packed` go into one Flate-compressed object
 * stream, and the cross-reference stream is also Flate-compressed (PDF 1.5+ layout).
 * `objectStreamParams` is added to the object stream dictionary, for negative tests.
 */
export function compressedPdf(
  bodies: string[],
  packed: number[],
  options: { objectStreamParams?: string } = {}
): Uint8Array {
  const count = bodies.length;
  const objectStreamNumber = count + 1;
  const xrefNumber = count + 2;
  const size = count + 3;
  const parts: Buffer[] = [Buffer.from('%PDF-1.7\n', 'latin1')];
  let length = parts[0].length;
  const offsets = new Map<number, number>();
  const push = (chunk: string | Buffer) => {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk, 'latin1') : chunk;
    parts.push(buffer);
    length += buffer.length;
  };

  for (let number = 1; number <= count; number += 1) {
    if (packed.includes(number)) continue;
    offsets.set(number, length);
    push(`${number} 0 obj\n${bodies[number - 1]}\nendobj\n`);
  }

  const packedNumbers = packed.slice();
  const headerPairs: string[] = [];
  let content = '';
  packedNumbers.forEach((number) => {
    headerPairs.push(`${number} ${content.length}`);
    content += `${bodies[number - 1]}\n`;
  });
  const header = `${headerPairs.join(' ')}\n`;
  const compressed = deflateSync(Buffer.from(header + content, 'latin1'));
  offsets.set(objectStreamNumber, length);
  const objStmParams = options.objectStreamParams ? ` ${options.objectStreamParams}` : '';
  push(
    Buffer.concat([
      Buffer.from(
        `${objectStreamNumber} 0 obj\n<< /Type /ObjStm /N ${packedNumbers.length} /First ${header.length}` +
          ` /Filter /FlateDecode${objStmParams} /Length ${compressed.length} >>\nstream\n`,
        'latin1'
      ),
      compressed,
      Buffer.from('\nendstream\nendobj\n', 'latin1')
    ])
  );

  const xrefOffset = length;
  offsets.set(xrefNumber, xrefOffset);
  const rows: number[][] = [];
  for (let number = 0; number < size; number += 1) {
    if (number === 0) rows.push([0, 0, 0]);
    else if (packed.includes(number)) rows.push([2, objectStreamNumber, packedNumbers.indexOf(number)]);
    else rows.push([1, offsets.get(number) ?? 0, 0]);
  }
  const rowBytes = Buffer.alloc(rows.length * 7);
  rows.forEach((row, index) => {
    rowBytes[index * 7] = row[0];
    rowBytes.writeUInt32BE(row[1], index * 7 + 1);
    rowBytes[index * 7 + 5] = 0;
    rowBytes[index * 7 + 6] = row[2];
  });
  const xrefData = deflateSync(rowBytes);
  push(
    Buffer.concat([
      Buffer.from(
        `${xrefNumber} 0 obj\n<< /Type /XRef /Size ${size} /W [1 4 2] /Root 1 0 R /Filter /FlateDecode /Length ${xrefData.length} >>\nstream\n`,
        'latin1'
      ),
      xrefData,
      Buffer.from('\nendstream\nendobj\n', 'latin1')
    ])
  );
  push(`startxref\n${xrefOffset}\n%%EOF\n`);
  return new Uint8Array(Buffer.concat(parts));
}

/**
 * Appends an incremental revision to `base`. The new objects replace the old
 * ones with the same numbers, and the new section points back through /Prev.
 */
export function appendRevision(base: Uint8Array, changed: Record<number, string>): Uint8Array {
  const baseText = new TextDecoder('latin1').decode(base);
  const previous = Number(/startxref\s+(\d+)/.exec(baseText.slice(baseText.lastIndexOf('startxref')))?.[1]);
  const size = Number(/\/Size\s+(\d+)/.exec(baseText)?.[1]);
  let text = baseText;
  const entries: { number: number; offset: number }[] = [];
  for (const [key, body] of Object.entries(changed)) {
    const number = Number(key);
    entries.push({ number, offset: text.length });
    text += `${number} 0 obj\n${body}\nendobj\n`;
  }
  const xrefOffset = text.length;
  text += 'xref\n';
  for (const entry of entries) {
    text += `${entry.number} 1\n${String(entry.offset).padStart(10, '0')} 00000 n \n`;
  }
  text += `trailer\n<< /Size ${size} /Root 1 0 R /Prev ${previous} >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(text);
}
