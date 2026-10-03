/** Localize image references without writing service diagnostics or signed URLs into a note. */
export async function localizeSciverseImages(
  markdown: string,
  saveImage: (url: string, imageIndex: number) => Promise<string>
): Promise<string> {
  const replacements = new Map<string, Promise<string>>();
  const failures: number[] = [];
  const localize = (url: string) => {
    if (!replacements.has(url)) {
      const imageIndex = replacements.size + 1;
      replacements.set(url, Promise.resolve().then(() => saveImage(url, imageIndex)).catch(() => {
        failures.push(imageIndex);
        return `[图片 ${imageIndex} 未能保存到本地]`;
      }));
    }
    return replacements.get(url)!;
  };

  const markdownPattern = /!\[([^\]]*)\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;
  const htmlPattern = /<img\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1[^>]*>/gi;
  let result = await replaceAsync(markdown, markdownPattern, async (_whole, alt, bracketedUrl, bareUrl) => {
    const path = await localize(bracketedUrl || bareUrl);
    return path.startsWith('./') ? `![${alt}](${path})` : path;
  });
  result = await replaceAsync(result, htmlPattern, async (whole, _quote, url) => {
    const alt = /\balt\s*=\s*(["'])(.*?)\1/i.exec(whole)?.[2] ?? '远程图片';
    const path = await localize(url);
    return path.startsWith('./') ? `<img src="${path}" alt="${escapeHtmlAttribute(alt)}" />` : path;
  });

  if (failures.length === 0) return result;
  failures.sort((left, right) => left - right);
  const summary = failures.slice(0, 5).map(index => `- 图片 ${index} 未能保存到本地。`).join('\n');
  const remaining = failures.length > 5 ? `\n- 另有 ${failures.length - 5} 张图片未能保存。` : '';
  return `${result}\n\n> 以下远程图片未能离线保存，在线引用已移除：\n${summary}${remaining}\n`;
}

async function replaceAsync(value: string, pattern: RegExp, replacer: (...matches: string[]) => Promise<string>) {
  const matches = [...value.matchAll(pattern)];
  if (matches.length === 0) return value;
  const replacements = await Promise.all(matches.map(match => replacer(...match)));
  let offset = 0;
  return matches.reduce((result, match, index) => {
    const start = match.index! + offset;
    const replacement = replacements[index];
    offset += replacement.length - match[0].length;
    return `${result.slice(0, start)}${replacement}${result.slice(start + match[0].length)}`;
  }, value);
}

function escapeHtmlAttribute(value: string) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
