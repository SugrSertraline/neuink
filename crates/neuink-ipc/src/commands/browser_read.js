function readBrowserDocument(expectedUrl, Readability) {
  const clip = (text, limit) => {
    let end = Math.min(text.length, limit);
    if (end > 0 && /[\uD800-\uDBFF]/.test(text.charAt(end - 1))) end--;
    return text.slice(0, end);
  };
  // This function runs once in the existing page. Never inspect cookies, storage, form
  // values, HTML attributes containing links, or child-frame documents.
  try {
    if (location.href !== expectedUrl) return { status: 'changed' };
    if (document.readyState !== 'complete') return { status: 'loading' };
    if (document.contentType === 'application/pdf' || document.querySelector('embed[type="application/pdf"],object[type="application/pdf"]')) {
      return { status: 'pdf', url: location.href, title: clip(document.title, 500) };
    }
    if (!document.body || !['text/html', 'application/xhtml+xml'].includes(document.contentType)) {
      return { status: 'unsupported' };
    }
    const excluded = 'script,style,noscript,template,iframe,frame,object,embed,input,textarea,select,option,button,form,[contenteditable],[role="textbox"],[hidden],[inert],[aria-hidden="true" i]';
    const skipChrome = 'nav,header,footer,aside,[role="navigation"],[role="banner"],[role="contentinfo"]';
    let truncated = false;
    let visits = 0;
    const budgetExceeded = {};
    const startedAt = performance.now();
    const visible = (element) => {
      if (element.matches(excluded) || element.isContentEditable) return false;
      const details = element.parentElement;
      if (details?.localName === 'details' && !details.hasAttribute('open')
        && details.querySelector(':scope > summary') !== element) return false;
      const style = getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse'
        && style.contentVisibility !== 'hidden' && style.opacity !== '0';
    };
    const visibleAncestors = (element) => {
      for (let parent = element; parent; parent = parent.parentElement) {
        if (!budgetAvailable()) return false;
        if (!visible(parent)) return false;
      }
      return true;
    };
    const budgetAvailable = () => {
      if (++visits > 20_000 || performance.now() - startedAt > 150) {
        truncated = true;
        return false;
      }
      return true;
    };
    const collect = (root, limit, ranges) => {
      if (!visibleAncestors(root)) return '';
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          // TreeWalker also visits rejected siblings internally, before nextNode returns.
          // Abort from the filter so hidden-node floods cannot bypass the work budget.
          if (!budgetAvailable()) throw budgetExceeded;
          if (node.nodeType === Node.ELEMENT_NODE) {
            return visible(node) && (ranges || !node.matches(skipChrome)) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
          }
          if (node.parentElement?.localName === 'details' && !node.parentElement.hasAttribute('open')) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      const parts = [];
      let length = 0;
      try {
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (node.nodeType !== Node.TEXT_NODE) continue;
          let value = '';
          if (ranges) {
            for (const range of ranges) {
              if (!range.intersectsNode(node)) continue;
              const start = range.startContainer === node ? range.startOffset : 0;
              const end = range.endContainer === node ? range.endOffset : node.length;
              const boundedEnd = Math.min(end, start + limit - length + 1);
              if (boundedEnd < end) truncated = true;
              value += node.data.slice(start, boundedEnd);
            }
          } else {
            if (node.length > limit - length) truncated = true;
            value = node.data.slice(0, limit - length + 1);
          }
          value = value.replace(/\s+/g, ' ').trim();
          if (!value) continue;
          if (length + value.length + 1 > limit) {
            parts.push(value.slice(0, Math.max(0, limit - length)));
            truncated = true;
            break;
          }
          parts.push(value);
          length += value.length + 1;
        }
      } catch (error) {
        if (error !== budgetExceeded) throw error;
      }
      return parts.join('\n').slice(0, limit).trim();
    };
    // Read only safe text-node intersections; serializing a Selection could include text
    // from a textarea or contenteditable area when a selection crosses those nodes.
    const selection = window.getSelection();
    const ranges = [];
    if (selection && !selection.isCollapsed) {
      for (let index = 0; index < Math.min(selection.rangeCount, 8); index++) {
        ranges.push(selection.getRangeAt(index));
      }
    }
    const selectedText = ranges.length ? collect(document.body, 8_000, ranges) : '';
    // Build a bounded, inert document containing only already-loaded safe visible content.
    // Readability owns article extraction, but it is not a privacy filter by itself.
    const articleText = () => {
      if (typeof Readability !== 'function' || truncated || !visibleAncestors(document.body)) return '';
      const clean = document.implementation.createHTMLDocument(clip(document.title, 500));
      const clones = new WeakMap([[document.body, clean.body]]);
      const tags = new Set(['article', 'section', 'main', 'div', 'p', 'span', 'a', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'ul', 'ol', 'li', 'table', 'tbody', 'thead', 'tr', 'td', 'th', 'blockquote', 'pre', 'code', 'br', 'b', 'strong', 'em', 'i']);
      let length = 0;
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          if (!budgetAvailable()) throw budgetExceeded;
          if (node.nodeType === Node.ELEMENT_NODE) return visible(node) && !node.matches(skipChrome)
            ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
          if (node.parentElement?.localName === 'details' && !node.parentElement.hasAttribute('open')) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      try {
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const parent = clones.get(node.parentNode);
          if (!parent) continue;
          if (node.nodeType === Node.TEXT_NODE) {
            const value = node.data.slice(0, Math.max(0, 100_000 - length));
            length += value.length;
            parent.appendChild(clean.createTextNode(value));
            if (length >= 100_000) { truncated = true; break; }
          } else {
            const clone = clean.createElement(tags.has(node.localName) ? node.localName : 'div');
            for (const name of ['class', 'id']) {
              const value = node.getAttribute(name);
              if (value) clone.setAttribute(name, value.slice(0, 200));
            }
            clones.set(node, clone);
            parent.appendChild(clone);
          }
        }
      } catch (error) { if (error !== budgetExceeded) throw error; }
      if (!clean.body.textContent.trim()) return '';
      // Upstream serializer returns plain text, so no remote HTML is ever rendered in the host.
      const article = new Readability(clean, { maxElemsToParse: 20_000, charThreshold: 200,
        serializer: element => element.textContent }).parse();
      return article?.textContent?.trim() ?? '';
    };
    let article = '';
    try { article = articleText(); } catch { /* Non-articles retain the bounded visible-text fallback. */ }
    const candidate = document.querySelector('main,[role="main"],article');
    const main = candidate && visibleAncestors(candidate) ? candidate : null;
    let text = article || (main ? collect(main, 32_000) : '');
    if (!text && !truncated) text = collect(document.body, 32_000);
    if (text.length > 32_000) { text = clip(text, 32_000); truncated = true; }
    if (location.href !== expectedUrl) return { status: 'changed' };
    return { status: 'ok', title: clip(document.title, 500), url: location.href,
      text: clip(text, 32_000), selection: clip(selectedText, 8_000), truncated, contentType: 'webpage',
      extractor: article ? 'mozilla-readability' : 'visible-text', isVideo: Boolean(document.querySelector('video,audio')) };
  } catch {
    return { status: 'unsupported' };
  }
}
