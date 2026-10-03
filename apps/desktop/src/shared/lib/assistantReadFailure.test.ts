import { describe, expect, it, vi } from 'vitest';
import { ASSISTANT_READ_FAILURES, describeAssistantReadFailure, safeAssistantReadFailure } from './assistantReadFailure';

describe('fixed reading failure guidance', () => {
  it.each([
    ['网页仍在加载，请等待加载完成后重试。', 'loading'],
    ['网页已切换、重新加载或关闭，请重新发送请求。', 'changed'],
    ['公开 PDF 读取超时，请稍后重试。', 'pdfDownloadTimeout'],
    ['公开 PDF 下载超时。', 'pdfDownloadTimeout'],
    ['公开 PDF 下载连接失败。', 'pdfDownloadNetwork'],
    ['PDF 文字提取超时，请缩小页数后重试。', 'pdfExtractTimeout'],
    ['网页读取超时，请稍后重试。', 'timeout'],
    ['这些 PDF 页没有可读取的文字层，可能是扫描件。', 'noText'],
    ['响应超过大小限制', 'tooLarge'],
    ['页码超出范围，PDF 共 12 页。', 'pageRange'],
    ['该网页未返回有效 PDF，可能需要登录。', 'invalidPdf'],
    ['PDF 文字读取失败：文件可能加密、损坏或字体不受支持。', 'pdfDecode'],
    ['远程服务返回 HTTP 403', 'denied'],
    ['无法解析服务地址', 'network'],
    ['视频字幕组件未随此版本完整打包', 'unavailable'],
    ['Unexpected exception', 'unknown'],
  ] as const)('maps %s to fixed guidance without copying private data', (message, code) => {
    const result = describeAssistantReadFailure(`${message} token=PRIVATE C:\\Users\\private.pdf <html>RESPONSE_BODY</html>`);
    expect(result).toBe(ASSISTANT_READ_FAILURES[code]);
    expect(result).not.toMatch(/PRIVATE|Users|RESPONSE_BODY/);
  });
  it('only permits exact complete templates through later presentation', () => {
    for (const value of Object.values(ASSISTANT_READ_FAILURES)) {
      expect(safeAssistantReadFailure(value)).toBe(value);
      expect(safeAssistantReadFailure(`${value} PRIVATE_SUFFIX`)).toBeUndefined();
      expect(safeAssistantReadFailure(`PRIVATE_PREFIX ${value}`)).toBeUndefined();
    }
  });
  it('never stringifies payloads or trusts throwing accessors', () => {
    const toString = vi.fn(() => 'SECRET');
    expect(describeAssistantReadFailure({ toString })).toBe(ASSISTANT_READ_FAILURES.unknown);
    expect(describeAssistantReadFailure({ get message() { throw Error('SECRET'); } })).toBe(ASSISTANT_READ_FAILURES.unknown);
    expect(toString).not.toHaveBeenCalled();
  });
});
