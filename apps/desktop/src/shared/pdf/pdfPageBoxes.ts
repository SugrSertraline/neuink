/**
 * Reads each page's MediaBox and CropBox from the PDF object structure.
 *
 * PDF.js exposes only `page.view`, the CropBox intersected with the MediaBox.
 * Two files can share that view and still differ in MediaBox, so the verifier
 * needs both boxes.
 *
 * Objects come from pdf-lib's read-only parser, which handles classic tables,
 * compressed cross-reference streams and object streams. pdf-lib does not check
 * cross-reference offsets, and it silently replaces a damaged trailer /Root with
 * a scanned catalog. This module adds the checks that pdf-lib leaves out:
 *  - startxref must point at a cross-reference section or an object header;
 *  - each in-use entry of a classic table must point at its own object header;
 *  - a damaged trailer /Root fails instead of being replaced;
 *  - encrypted files and object streams with /DecodeParms are rejected.
 * Cross-reference stream entries are not checked, because pdf-lib discards them
 * after parsing. Callers still compare the boxes with PDF.js `page.view`.
 */
import type { PDFContext, PDFObject } from 'pdf-lib';

export type PdfBox = [number, number, number, number];

export type PageBoxes = {
  media_box: PdfBox;
  crop_box: PdfBox;
};

export type PageBoxResult =
  | { proof: 'independent'; pages: PageBoxes[] }
  | { proof: 'unavailable'; reason: string };

type PdfLib = typeof import('pdf-lib');

const MAX_HOPS = 8;
const MAX_PAGE_DEPTH = 64;

class Unsupported extends Error {}

function toInteger(token: string | undefined): number | undefined {
  return token !== undefined && /^\d+$/.test(token) ? Number(token) : undefined;
}

function previousSection(text: string): number | undefined {
  const match = /\/Prev\s+(\d+)/.exec(text);
  return match ? Number(match[1]) : undefined;
}

function requireObjectHeader(text: string, offset: number, number: number, generation: number) {
  const match = /^(\d+)\s+(\d+)\s+obj\b/.exec(text.slice(offset, offset + 32));
  if (!match || Number(match[1]) !== number || Number(match[2]) !== generation) {
    throw new Unsupported(`交叉引用指向的对象 ${number} 位置不正确`);
  }
}

/** Parses the subsections of one classic table and returns its in-use entries. */
function classicInUseEntries(body: string) {
  const tokens = body.split(/\s+/).filter(Boolean);
  const entries: { number: number; generation: number; offset: number }[] = [];
  let index = 0;
  while (index < tokens.length) {
    const first = toInteger(tokens[index]);
    const count = toInteger(tokens[index + 1]);
    if (first === undefined || count === undefined) throw new Unsupported('交叉引用子段头无效');
    index += 2;
    if (count * 3 > tokens.length - index) throw new Unsupported('交叉引用子段长度不足');
    for (let entry = 0; entry < count; entry += 1) {
      const offset = toInteger(tokens[index]);
      const generation = toInteger(tokens[index + 1]);
      const type = tokens[index + 2];
      index += 3;
      if (offset === undefined || generation === undefined || (type !== 'n' && type !== 'f')) {
        throw new Unsupported('交叉引用条目无效');
      }
      if (type === 'n') entries.push({ number: first + entry, generation, offset });
    }
  }
  return entries;
}

/**
 * Follows the cross-reference chain from startxref. Classic tables are checked
 * entry by entry. Cross-reference streams are only located, because their
 * entries are not visible after pdf-lib parses them.
 */
function checkCrossReferenceChain(text: string) {
  const startxrefAt = text.lastIndexOf('startxref');
  if (startxrefAt < 0) throw new Unsupported('缺少 startxref');
  const startValue = /^startxref\s+(\d+)/.exec(text.slice(startxrefAt, startxrefAt + 64));
  if (!startValue) throw new Unsupported('startxref 值无效');

  const seen = new Set<number>();
  let offset: number | undefined = Number(startValue[1]);
  while (offset !== undefined) {
    if (seen.has(offset)) throw new Unsupported('交叉引用链存在循环');
    seen.add(offset);
    const head = text.slice(offset, offset + 512);
    if (/^xref\s/.test(head)) {
      const trailerAt = text.indexOf('trailer', offset);
      const sectionEnd = trailerAt < 0 ? -1 : text.indexOf('startxref', trailerAt);
      if (trailerAt < 0 || sectionEnd < 0) throw new Unsupported('经典交叉引用缺少 trailer');
      const trailer = text.slice(trailerAt, sectionEnd);
      if (trailer.includes('/XRefStm')) throw new Unsupported('混合式交叉引用未验证');
      for (const entry of classicInUseEntries(text.slice(offset + 4, trailerAt))) {
        requireObjectHeader(text, entry.offset, entry.number, entry.generation);
      }
      offset = previousSection(trailer);
    } else if (/^\d+\s+\d+\s+obj\b/.test(head)) {
      const dictEnd = text.indexOf('stream', offset);
      if (dictEnd < 0) throw new Unsupported('交叉引用流缺少 stream');
      offset = previousSection(text.slice(offset, dictEnd));
    } else {
      throw new Unsupported('startxref 未指向交叉引用');
    }
  }
}

/** pdf-lib drops the cross-reference stream's own dictionary, so object streams are checked here. */
function rejectObjectStreamParameters(text: string) {
  for (const match of text.matchAll(/\/Type\s*\/ObjStm/g)) {
    const headerAt = text.lastIndexOf('obj', match.index);
    const streamAt = text.indexOf('stream', match.index ?? 0);
    if (headerAt < 0 || streamAt < 0) throw new Unsupported('对象流结构无法确认');
    if (/\/(DecodeParms|DP)\b/.test(text.slice(headerAt, streamAt))) {
      throw new Unsupported('对象流带解码参数，未支持');
    }
  }
}

/**
 * Parses the file with pdf-lib's own parser, the same class `PDFDocument.load`
 * uses, and without writing anything back. `maybeRecoverRoot` is private in the
 * type declarations, so it is wrapped at runtime. The wrapper fails when the
 * trailer's /Root is not a catalog, because pdf-lib would otherwise pick a
 * catalog by scanning. The package is pinned to an exact version.
 */
async function parseContext(lib: PdfLib, bytes: Uint8Array): Promise<PDFContext> {
  const parser = lib.PDFParser.forBytesWithOptions(bytes, Infinity, true, false);
  const target = parser as unknown as {
    context: PDFContext;
    maybeRecoverRoot: () => void;
  };
  const recoverRoot = target.maybeRecoverRoot.bind(parser);
  target.maybeRecoverRoot = () => {
    const root = target.context.lookup(target.context.trailerInfo.Root);
    if (!(root instanceof lib.PDFDict) || root.get(lib.PDFName.of('Type')) !== lib.PDFName.of('Catalog')) {
      throw new Unsupported('交叉引用的目录对象无效，pdf-lib 会静默改选目录');
    }
    recoverRoot();
  };
  return parser.parseDocument();
}

function resolve(lib: PdfLib, context: PDFContext, value: PDFObject | undefined): PDFObject | undefined {
  let current = value;
  for (let hop = 0; current instanceof lib.PDFRef; hop += 1) {
    if (hop >= MAX_HOPS) throw new Unsupported('间接引用层数过多');
    current = context.lookup(current);
  }
  return current;
}

function parseBox(lib: PdfLib, context: PDFContext, raw: PDFObject | undefined): PdfBox {
  const array = resolve(lib, context, raw);
  if (!(array instanceof lib.PDFArray) || array.size() !== 4) {
    throw new Unsupported('页面框必须是四个数字组成的数组');
  }
  const numbers = [0, 1, 2, 3].map((index) => {
    const value = resolve(lib, context, array.get(index));
    if (!(value instanceof lib.PDFNumber) || !Number.isFinite(value.asNumber())) {
      throw new Unsupported('页面框包含非数字');
    }
    return value.asNumber();
  });
  return [numbers[0], numbers[1], numbers[2], numbers[3]];
}

type Inherited = { mediaBox?: PDFObject; cropBox?: PDFObject };

function walkPages(
  lib: PdfLib,
  context: PDFContext,
  node: PDFObject | undefined,
  inherited: Inherited,
  depth: number,
  visited: Set<number>,
  pages: PageBoxes[]
) {
  if (depth > MAX_PAGE_DEPTH) throw new Unsupported('页树嵌套过深');
  if (!(node instanceof lib.PDFRef)) throw new Unsupported('页树节点必须是间接对象');
  if (visited.has(node.objectNumber)) throw new Unsupported('页树存在循环引用');
  visited.add(node.objectNumber);

  const dict = resolve(lib, context, node);
  if (!(dict instanceof lib.PDFDict)) throw new Unsupported('页树节点不是字典');
  const current: Inherited = {
    mediaBox: dict.get(lib.PDFName.of('MediaBox')) ?? inherited.mediaBox,
    cropBox: dict.get(lib.PDFName.of('CropBox')) ?? inherited.cropBox
  };
  const kids = resolve(lib, context, dict.get(lib.PDFName.of('Kids')));
  const isPage = resolve(lib, context, dict.get(lib.PDFName.of('Type'))) === lib.PDFName.of('Page');
  if (kids instanceof lib.PDFArray && !isPage) {
    for (let index = 0; index < kids.size(); index += 1) {
      walkPages(lib, context, kids.get(index), current, depth + 1, visited, pages);
    }
    return;
  }

  if (current.mediaBox === undefined) throw new Unsupported('页面缺少 MediaBox');
  const mediaBox = parseBox(lib, context, current.mediaBox);
  // CropBox defaults to MediaBox when absent (PDF specification, 14.11.2).
  const cropBox = current.cropBox === undefined ? mediaBox : parseBox(lib, context, current.cropBox);
  pages.push({ media_box: mediaBox, crop_box: cropBox });
}

/**
 * Reads the MediaBox and CropBox of every page. Returns `unavailable` with a
 * reason when the file is encrypted, damaged, or outside the checked subset.
 * The caller must then treat the page boxes as unproven.
 */
export async function readPageBoxes(bytes: Uint8Array): Promise<PageBoxResult> {
  try {
    const text = new TextDecoder('latin1').decode(bytes);
    checkCrossReferenceChain(text);
    rejectObjectStreamParameters(text);

    const lib = await import('pdf-lib');
    const context = await parseContext(lib, bytes);
    if (context.trailerInfo.Encrypt !== undefined) throw new Unsupported('加密文件未支持几何独立证明');

    const root = resolve(lib, context, context.trailerInfo.Root);
    if (!(root instanceof lib.PDFDict)) throw new Unsupported('目录对象无效');
    const pagesRef = root.get(lib.PDFName.of('Pages'));
    if (!(pagesRef instanceof lib.PDFRef)) throw new Unsupported('页树根节点必须是间接对象');
    const pagesRoot = resolve(lib, context, pagesRef);
    if (!(pagesRoot instanceof lib.PDFDict)) throw new Unsupported('页树根节点不是字典');

    const pages: PageBoxes[] = [];
    walkPages(lib, context, pagesRef, {}, 0, new Set<number>(), pages);
    if (pages.length === 0) throw new Unsupported('页数为零');
    const declared = resolve(lib, context, pagesRoot.get(lib.PDFName.of('Count')));
    if (!(declared instanceof lib.PDFNumber)) throw new Unsupported('页树缺少 Count');
    if (declared.asNumber() !== pages.length) {
      throw new Unsupported(`页数 ${pages.length} 与页树声明的 ${declared.asNumber()} 不一致`);
    }
    return { proof: 'independent', pages };
  } catch (error) {
    return {
      proof: 'unavailable',
      reason: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Intersects a MediaBox and CropBox the way PDF.js builds `page.view`. Returns
 * `null` when they do not overlap, which PDF.js reports as the MediaBox.
 */
export function visibleBoxFromBoxes(media: PdfBox, crop: PdfBox): PdfBox | null {
  const x0 = Math.max(Math.min(crop[0], crop[2]), Math.min(media[0], media[2]));
  const y0 = Math.max(Math.min(crop[1], crop[3]), Math.min(media[1], media[3]));
  const x1 = Math.min(Math.max(crop[0], crop[2]), Math.max(media[0], media[2]));
  const y1 = Math.min(Math.max(crop[1], crop[3]), Math.max(media[1], media[3]));
  if (x1 - x0 <= 0 || y1 - y0 <= 0) return null;
  return [x0, y0, x1, y1];
}
