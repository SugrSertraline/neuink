const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { JSDOM } = require('jsdom');

const source = readFileSync(join(__dirname, 'browser_read.js'), 'utf8');
const readabilitySource = readFileSync(join(__dirname, 'vendor/readability/Readability.js'), 'utf8');
const url = 'https://example.org/article?token=private#section';
async function documentFor(body, extra = '') {
  const dom = new JSDOM(`<html><head><title>Article title</title>${extra}</head><body>${body}</body></html>`, {
    url, runScripts: 'outside-only', pretendToBeVisual: true
  });
  await new Promise(resolve => dom.window.addEventListener('load', resolve, { once: true }));
  dom.window.eval(`${source}; window.capture = readBrowserDocument;`);
  return dom;
}

test('reads loaded main content and excludes forms, hidden content, frames and navigation', async () => {
  const dom = await documentFor(`<nav>navigation</nav><main><h1>Paper title</h1><p>Useful text.</p>
    <form>form label<input value="password"><textarea>textarea secret</textarea></form>
    <div contenteditable="true">draft secret</div><div role="textbox">editor secret</div>
    <div hidden>hidden secret</div><div style="display:none">hidden CSS secret</div>
    <div style="visibility:hidden">invisible secret</div><div style="opacity:0">transparent secret</div>
    <script>script secret</script><iframe srcdoc="frame secret"></iframe><aside>Sidebar text</aside></main>`);
  const result = dom.window.capture(url);
  assert.equal(result.status, 'ok');
  assert.equal(result.title, 'Article title');
  assert.equal(result.text, 'Paper title\nUseful text.');
  assert.equal(result.selection, '');
  assert.equal(result.truncated, false);
  dom.window.close();
});

test('selection clips safe text nodes and cannot include crossed editable/form content', async () => {
  const dom = await documentFor('<main><p id="start">First paragraph</p><textarea>secret</textarea><div contenteditable>private draft</div><p id="end">Last paragraph</p></main>');
  const range = dom.window.document.createRange();
  range.setStart(dom.window.document.getElementById('start').firstChild, 6);
  range.setEnd(dom.window.document.getElementById('end').firstChild, 4);
  dom.window.getSelection().addRange(range);
  assert.equal(dom.window.capture(url).selection, 'paragraph\nLast');
  range.selectNodeContents(dom.window.document.querySelector('[contenteditable]'));
  dom.window.getSelection().removeAllRanges();
  dom.window.getSelection().addRange(range);
  assert.equal(dom.window.capture(url).selection, '');
  dom.window.close();
});

test('refuses changed URLs and loading documents and caps long pages', async () => {
  const dom = await documentFor(`<article>${'text '.repeat(10_000)}</article>`);
  assert.equal(dom.window.capture('https://example.org/other').status, 'changed');
  const result = dom.window.capture(url);
  assert.equal(result.status, 'ok');
  assert.ok(result.text.length <= 32_000);
  assert.equal(result.truncated, true);
  Object.defineProperty(dom.window.document, 'readyState', { value: 'loading', configurable: true });
  assert.equal(dom.window.capture(url).status, 'loading');
  dom.window.close();
});

test('falls back to body text when main is empty and never falls into a hidden ancestor', async () => {
  const dom = await documentFor('<div hidden><main>secret</main></div><article></article><p>Visible body</p>');
  assert.equal(dom.window.capture(url).text, 'Visible body');
  dom.window.close();
});

test('does not install listeners, timers, callbacks or read private browser state', () => {
  for (const forbidden of ['setInterval', 'setTimeout', 'addEventListener', '__TAURI__', 'postMessage',
    'localStorage', 'sessionStorage', 'document.cookie', 'innerHTML', 'outerHTML', '.value', '.toString()']) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});

test('closed disclosure text stays excluded from both body text and a crossed selection', async () => {
  const dom = await documentFor('<main><p id="start">Before</p><details><summary>Public summary</summary>Hidden direct text<p>Hidden child text</p><summary>Hidden second summary</summary></details><p id="end">After</p></main>');
  const range = dom.window.document.createRange();
  range.setStartBefore(dom.window.document.getElementById('start'));
  range.setEndAfter(dom.window.document.getElementById('end'));
  dom.window.getSelection().addRange(range);
  const snapshot = dom.window.capture(url);
  assert.equal(snapshot.text, 'Before\nPublic summary\nAfter');
  assert.equal(snapshot.selection, 'Before\nPublic summary\nAfter');
  dom.window.document.querySelector('details').setAttribute('open', '');
  assert.ok(dom.window.capture(url).text.includes('Hidden child text'));
  dom.window.close();
});

test('the traversal budget includes rejected hidden elements', async () => {
  const dom = await documentFor(`<main>${'<span hidden>secret</span>'.repeat(20_100)}<p>Beyond budget</p></main>`);
  dom.window.performance.now = () => 0;
  const snapshot = dom.window.capture(url);
  assert.equal(snapshot.status, 'ok');
  assert.equal(snapshot.text, '');
  assert.equal(snapshot.truncated, true);
  dom.window.close();
});

const articleParagraph = 'Readers need evidence, context, and a clear explanation of each finding. '
  + 'This article describes reproducible observations and the practical limits of its conclusions. '
  + 'The paragraphs contain enough connected prose for the upstream article parser to identify the main story. ';

async function articleDocument(t, body, extra = '') {
  const dom = await documentFor(body, extra);
  t.after(() => dom.window.close());
  dom.window.eval(readabilitySource);
  // Deterministic count/size budget tests must not depend on CI load or JSDOM style timing.
  dom.window.performance.now = () => 0;
  return dom;
}

function articleBody(extra = '') {
  return `<main><article class="post-content"><h1>The documented finding</h1>
    <p>${articleParagraph.repeat(2)}</p>${extra}<p>${articleParagraph.repeat(2)}</p></article></main>`;
}

test('the real Readability parser extracts an article and removes comment blocks', async t => {
  const dom = await articleDocument(t, articleBody('<div class="comment"><p>Visitor comment marker. Unrelated replies are not the article.</p></div>'));
  let calls = 0;
  const originalParse = dom.window.Readability.prototype.parse;
  dom.window.Readability.prototype.parse = function () { calls++; return originalParse.call(this); };
  const snapshot = dom.window.capture(url, dom.window.Readability);
  assert.equal(calls, 1);
  assert.equal(snapshot.status, 'ok');
  assert.equal(snapshot.extractor, 'mozilla-readability');
  assert.ok(snapshot.text.includes('reproducible observations'));
  assert.ok(!snapshot.text.includes('Visitor comment marker'));
  assert.equal(snapshot.truncated, false);
});

test('Readability receives safe visible content without form, editor, hidden or private metadata text', async t => {
  const dom = await articleDocument(t, articleBody(`
    <form>FORM_SECRET<input value="VALUE_SECRET"><textarea>TEXTAREA_SECRET</textarea></form>
    <div contenteditable="false">EDITOR_SECRET</div><div role="textbox">TEXTBOX_SECRET</div>
    <p hidden>HIDDEN_SECRET</p><div inert>INERT_SECRET</div><p aria-hidden="TRUE">ARIA_SECRET</p>
    <div style="display:none"><p>DISPLAY_SECRET</p></div><p style="opacity:0">OPACITY_SECRET</p>
    <div style="visibility:hidden">VISIBILITY_SECRET</div><div style="content-visibility:hidden">CONTENT_VISIBILITY_SECRET</div>
    <script type="application/ld+json">{"description":"JSONLD_SECRET"}</script>
    <iframe srcdoc="FRAME_SECRET"></iframe><template>TEMPLATE_SECRET</template>
    <p title="TITLE_ATTR_SECRET" data-token="DATA_ATTR_SECRET" aria-label="ARIA_LABEL_SECRET">
      Public sentence and <a href="https://example.net/?token=LINK_SECRET">public citation label</a>.
      <img src="https://example.net/IMAGE_SECRET" alt="ALT_SECRET">
    </p>`), '<meta name="description" content="META_SECRET"><meta property="og:description" content="OG_SECRET">');
  for (const name of ['localStorage', 'sessionStorage']) {
    Object.defineProperty(dom.window, name, { get() { throw new Error(`Unexpected ${name} access`); } });
  }
  Object.defineProperty(dom.window.document, 'cookie', { get() { throw new Error('Unexpected cookie access'); } });
  dom.window.fetch = () => { throw new Error('Unexpected network request'); };
  const snapshot = dom.window.capture(url, dom.window.Readability);
  assert.equal(snapshot.status, 'ok');
  assert.equal(snapshot.extractor, 'mozilla-readability');
  assert.match(snapshot.text, /Public sentence/);
  assert.match(snapshot.text, /public citation label/);
  assert.doesNotMatch(JSON.stringify(snapshot), /[A-Z_]+_SECRET/);
});

test('Readability preserves original nodes, HTML, form values and selection boundaries', async t => {
  const dom = await articleDocument(t, articleBody('<p id="selectable">Keep this selected sentence intact.</p><input id="private-input" value="initial">'));
  const { document } = dom.window;
  const paragraph = document.getElementById('selectable');
  const input = document.getElementById('private-input');
  input.value = 'unsaved private value';
  let clicks = 0;
  paragraph.addEventListener('click', () => clicks++);
  const range = document.createRange();
  range.setStart(paragraph.firstChild, 5);
  range.setEnd(paragraph.firstChild, 18);
  dom.window.getSelection().addRange(range);
  const before = document.documentElement.outerHTML;
  const snapshot = dom.window.capture(url, dom.window.Readability);
  assert.equal(snapshot.extractor, 'mozilla-readability');
  assert.equal(snapshot.selection, 'this selected');
  assert.equal(document.documentElement.outerHTML, before);
  assert.equal(document.getElementById('selectable'), paragraph);
  assert.equal(input.value, 'unsaved private value');
  assert.equal(range.startContainer, paragraph.firstChild);
  assert.equal(range.startOffset, 5);
  assert.equal(range.endOffset, 18);
  paragraph.dispatchEvent(new dom.window.Event('click'));
  assert.equal(clicks, 1);
  assert.doesNotMatch(snapshot.text, /unsaved private value/);
});

test('Readability refuses an article whose body or document ancestor is hidden', async t => {
  for (const [tag, attribute, value] of [
    ['body', 'hidden', ''], ['body', 'style', 'display:none'], ['html', 'hidden', ''],
  ]) {
    const dom = await articleDocument(t, articleBody('<p>ROOT_HIDDEN_SECRET</p>'));
    dom.window.document.querySelector(tag).setAttribute(attribute, value);
    const snapshot = dom.window.capture(url, dom.window.Readability);
    assert.equal(snapshot.status, 'ok');
    assert.equal(snapshot.text, '', `${tag}[${attribute}]`);
    assert.doesNotMatch(JSON.stringify(snapshot), /ROOT_HIDDEN_SECRET/);
  }
});

test('Readability cloning counts hidden siblings toward its node budget', async t => {
  const dom = await articleDocument(t, `<main>${'<span hidden>HIDDEN_FLOOD_SECRET</span>'.repeat(20_100)}
    <article><p>${articleParagraph}</p><p>Beyond the node budget</p></article></main>`);
  const snapshot = dom.window.capture(url, dom.window.Readability);
  assert.equal(snapshot.status, 'ok');
  assert.equal(snapshot.text, '');
  assert.equal(snapshot.truncated, true);
  assert.equal(snapshot.extractor, 'visible-text');
});

test('real Readability output respects the text cap and reports a bounded large-node capture', async t => {
  const dom = await articleDocument(t, `<main><article><p>${articleParagraph.repeat(500)}</p>
    <p>Beyond the clone character budget</p></article></main>`);
  const snapshot = dom.window.capture(url, dom.window.Readability);
  assert.equal(snapshot.status, 'ok');
  assert.equal(snapshot.extractor, 'mozilla-readability');
  assert.ok(snapshot.text.length > 0 && snapshot.text.length <= 32_000);
  assert.equal(snapshot.truncated, true);
  assert.ok(!snapshot.text.includes('Beyond the clone character budget'));
});

test('Readability capture marks video and audio pages as page metadata without media content', async t => {
  for (const media of ['video', 'audio']) {
    const dom = await articleDocument(t, articleBody(`<${media} src="https://example.net/MEDIA_SECRET">
      <track kind="subtitles" src="https://example.net/TRACK_SECRET"></${media}>`));
    const snapshot = dom.window.capture(url, dom.window.Readability);
    assert.equal(snapshot.status, 'ok');
    assert.equal(snapshot.contentType, 'webpage');
    assert.equal(snapshot.isVideo, true);
    assert.equal(snapshot.extractor, 'mozilla-readability');
    assert.ok(!Object.hasOwn(snapshot, 'transcript'));
    assert.doesNotMatch(JSON.stringify(snapshot), /MEDIA_SECRET|TRACK_SECRET/);
  }
  const dom = await articleDocument(t, articleBody());
  assert.equal(dom.window.capture(url, dom.window.Readability).isVideo, false);
});

test('PDF detection handles actual MIME and embedded viewers before article extraction', async t => {
  for (const kind of ['mime', 'embed', 'object']) {
    const body = kind === 'mime' ? articleBody() : articleBody(`<${kind} type="application/pdf" data="https://example.net/PDF_SECRET" src="https://example.net/PDF_SECRET"></${kind}>`);
    const dom = await articleDocument(t, body);
    if (kind === 'mime') Object.defineProperty(dom.window.document, 'contentType', { value: 'application/pdf' });
    let parsed = false;
    const originalParse = dom.window.Readability.prototype.parse;
    dom.window.Readability.prototype.parse = function () { parsed = true; return originalParse.call(this); };
    const snapshot = dom.window.capture(url, dom.window.Readability);
    assert.equal(snapshot.status, 'pdf', kind);
    assert.equal(snapshot.title, 'Article title');
    assert.equal(snapshot.url, url);
    assert.equal(parsed, false);
    assert.ok(!Object.hasOwn(snapshot, 'text'));
    assert.doesNotMatch(JSON.stringify(snapshot), /PDF_SECRET/);
  }
});

test('non-PDF embeds do not turn a readable HTML article into a PDF result', async t => {
  const dom = await articleDocument(t, articleBody('<object type="image/svg+xml" data="https://example.net/EMBED_SECRET"></object>'));
  const snapshot = dom.window.capture(url, dom.window.Readability);
  assert.equal(snapshot.status, 'ok');
  assert.equal(snapshot.extractor, 'mozilla-readability');
  assert.doesNotMatch(JSON.stringify(snapshot), /EMBED_SECRET/);
});
