/** PDF visual line wrapping is not a sentence boundary. Only normalize the request copy. */
export function normalizeSelectionText(text: string): string {
  return text
    .replace(/\u00ad[ \t]*[\r\n\u2028\u2029]+[ \t]*/g, '')
    .replace(/([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}])[ \t]*[\r\n\u2028\u2029]+[ \t]*(?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}])/gu, '$1')
    .replace(/[ \t]*[\r\n\u2028\u2029]+[ \t]*/g, ' ')
    .trim();
}
