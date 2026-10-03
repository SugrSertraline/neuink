import { describe, expect, it, vi } from 'vitest';
import { localizeSciverseImages } from './sciverseRemoteImages';

describe('Sciverse offline image failure presentation', () => {
  it('keeps successful images and reports failures without persisting private diagnostics or URLs', async () => {
    const remote = 'https://example.test/private.png?token=private-token';
    const save = vi.fn(async (url: string) => {
      if (url === remote) throw new Error('HTTP 403 Authorization: private-key C:\\private\\data');
      return './assets/image.png';
    });
    const result = await localizeSciverseImages(`正文\n![正常图](https://example.test/ok.png)\n![${remote}](${remote})\n<img src="${remote}" />`, save);
    expect(save).toHaveBeenCalledTimes(2);
    expect(result).toContain('![正常图](./assets/image.png)');
    expect(result).toContain('[图片 2 未能保存到本地]');
    expect(result).toContain('- 图片 2 未能保存到本地。');
    for (const privatePart of ['private', '403', 'Authorization', 'token=']) expect(result).not.toContain(privatePart);
  });

  it('shares replacements across Markdown and HTML while preserving successful alt text', async () => {
    const save = vi.fn(async () => './assets/image.png');
    const result = await localizeSciverseImages('![Figure](https://example.test/a.png)\n<img alt="Figure" src="https://example.test/a.png" />', save);
    expect(save).toHaveBeenCalledExactlyOnceWith('https://example.test/a.png', 1);
    expect(result).toBe('![Figure](./assets/image.png)\n<img src="./assets/image.png" alt="Figure" />');
  });

  it('bounds and orders failure summaries, including synchronous save failures', async () => {
    const markdown = Array.from({ length: 7 }, (_, i) => `![image](https://example.test/${i}.png)`).join('\n');
    const result = await localizeSciverseImages(markdown, () => { throw new Error('raw exception'); });
    expect(result).toContain('- 图片 1 未能保存到本地。');
    expect(result).toContain('- 图片 5 未能保存到本地。');
    expect(result).not.toContain('- 图片 6');
    expect(result).toContain('另有 2 张图片未能保存。');
    expect(result).not.toContain('raw exception');
  });
});
