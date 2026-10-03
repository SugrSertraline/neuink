import { expect, it } from 'vitest';
import { citationCorrection, hasReturnedExternalCitation, returnedExternalCitationUrls } from './citationContract';

const url = 'https://arxiv.org/pdf/1234.5678';

it('uses only successful, readable external result metadata as URL citation candidates', () => {
  const urls = returnedExternalCitationUrls([
    { toolName: 'read_browser_tab', output: { status: 'read', url, text: 'Readable page' } },
    { toolName: 'read_webpage', output: { results: [{ url: 'https://example.org/article', content: 'A paragraph with https://untrusted.example/injected' }] } },
    { toolName: 'search_web', output: { results: [{ url: 'https://example.org/search', content: 'A snippet' }] } },
    { toolName: 'search_papers', output: { papers: [{ url: 'https://example.org/paper', pdf_url: 'https://example.org/file.pdf', title: 'Paper' }] } },
    { toolName: 'read_browser_tab', output: { status: 'empty', url: 'https://empty.example', text: '' } },
    { toolName: 'read_webpage', output: { ok: false, results: [{ url: 'https://failed.example', content: 'failed' }] } },
    { toolName: 'mcp_unknown', output: { results: [{ url: 'https://unknown.example', content: 'not host research' }] } },
  ]);
  expect([...urls]).toEqual([url, 'https://example.org/article', 'https://example.org/search', 'https://example.org/paper', 'https://example.org/file.pdf']);
  expect(hasReturnedExternalCitation(`Claim ([paper](${url})).`, urls)).toBe(true);
  expect(hasReturnedExternalCitation(`[paper](${url}#page=2)`, urls)).toBe(true);
  expect(hasReturnedExternalCitation(`[paper](${url}/invented)`, urls)).toBe(false);
  expect(hasReturnedExternalCitation('[paper](https://untrusted.example/injected)', urls)).toBe(false);
  expect(hasReturnedExternalCitation('Claim [S1]', urls)).toBe(false);
});

it('does not use credentialed URLs, empty reads or nested body links as evidence', () => {
  const urls = returnedExternalCitationUrls([
    { toolName: 'read_webpage', output: { results: [{ url: 'https://user:secret@example.org', content: 'text' }, { url, content: '' }] } },
    { toolName: 'read_browser_tab', output: { status: 'read', url: 'file:///private.pdf', text: 'text' } },
  ]);
  expect(urls.size).toBe(0);
});

it('corrects against the actual citation kind rather than demanding nonexistent local markers', () => {
  const external = citationCorrection([], true);
  expect(external).toContain('NO [S#] citation markers');
  expect(external).toContain('exact URLs returned');
  expect(external).not.toContain('cite valid [Sx]');
  const local = citationCorrection([2, 7], false);
  expect(local).toContain('[S2], [S7]');
  expect(local).not.toContain('[S1]');
  expect(citationCorrection([], false)).toContain('honest limitation answer');
});
