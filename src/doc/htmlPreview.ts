import { MAX_HIGHLIGHT_CHARS, RENDER_DEBOUNCE_MS } from '../config';
import { classifyLink } from '../core/urls';
import { S } from '../strings';

/**
 * A read-only look at an HTML file, loaded with import() the first time one is shown. The browser
 * renders it in a sandboxed `<iframe srcdoc>`: with no `allow-scripts` nothing in the file runs,
 * and a strict policy at the top of the page keeps it from loading anything. `allow-same-origin`
 * on its own lets the app read the scroll position and catch link clicks, and nothing more, since
 * no script in the frame can use it. WebKit doesn't run the app's listeners there, so it gets its
 * links another way: see rewriteLinks.
 */

/** Past this the preview stops following typing, so typing never pays for it. */
export const MAX_PREVIEW_CHARS = MAX_HIGHLIGHT_CHARS;
/** An update slower than this lengthens the wait before the next one, in proportion. */
const FRAME_BUDGET_MS = 50;

const DOCTYPE = /^﻿?\s*(?:<!--[\s\S]*?-->\s*)*<!doctype[^>]*>/i;

/**
 * The page with a policy as its first element. After a doctype, so that the page keeps its
 * rendering mode. A second policy can only tighten, so nothing in the file can undo this one.
 */
export function withPolicy(html: string, remoteImages: boolean, rewritten = false): string {
  const policy = `default-src 'none'; style-src 'unsafe-inline'; img-src data:${remoteImages ? ' https:' : ''}`;
  // Until links are known to be caught, a click on one that isn't does nothing: with no
  // allow-popups, a new window can't open, and the frame doesn't navigate away.
  const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}">${rewritten ? '' : '<base target="_blank">'}`;
  const doctype = DOCTYPE.exec(html);
  return doctype ? doctype[0] + meta + html.slice(doctype[0].length) : meta + html;
}

/** Where a rewritten link takes the frame. A blank page of the frame's own origin, which the app can read. */
const LINK_PAGE = 'about:blank#full-link=';

/**
 * For WebKit, which doesn't run the app's listeners in a frame that can't run scripts. Each link
 * instead takes the frame to a blank page whose address holds the link, which the app reads and
 * then puts the preview back, scrolled to the target for an in-page link (which would otherwise
 * resolve against the app's own address, as a srcdoc page has no address of its own). An
 * automatic redirect is removed, so that only a click ever reaches a link. Parsed in an inert
 * document, so nothing loads or runs.
 */
export function rewriteLinks(html: string): string {
  const page = new DOMParser().parseFromString(html, 'text/html');
  for (const refresh of Array.from(page.querySelectorAll('meta[http-equiv]'))) {
    if (refresh.getAttribute('http-equiv')!.trim().toLowerCase() === 'refresh') refresh.remove();
  }
  for (const base of Array.from(page.querySelectorAll('base'))) base.remove();
  for (const link of Array.from(page.querySelectorAll('a[href], area[href]'))) {
    const href = link.getAttribute('href')!;
    link.removeAttribute('target');
    link.setAttribute('href', LINK_PAGE + encodeURIComponent(href));
  }
  const doctype = page.doctype ? `<!DOCTYPE ${page.doctype.name}>` : '';
  return doctype + page.documentElement.outerHTML;
}

/** Whether the app's listeners run in the preview: unknown until the first page has loaded. */
let listenersWork: boolean | null = null;

export interface HtmlPreviewOptions {
  remoteImages: boolean;
  /** The current text, read only when an update runs, never on each keystroke. */
  text: () => string;
  length: () => number;
  openLink: (href: string) => void;
  /** Key presses in the frame don't reach the app's window, so they're handed on. */
  forwardKey: (event: KeyboardEvent) => boolean;
}

export class HtmlPreview {
  private frame: HTMLIFrameElement;
  private note: HTMLElement;
  private timer: number | undefined;
  private loading = false;
  private pending: string | null = null;
  private cost = 0;
  private destroyed = false;

  constructor(
    host: HTMLElement,
    private options: HtmlPreviewOptions,
  ) {
    this.note = document.createElement('div');
    this.note.className = 'html-preview-note';
    this.note.hidden = true;
    this.note.textContent = S.previewPaused;
    this.frame = document.createElement('iframe');
    this.frame.className = 'html-preview-frame';
    this.frame.setAttribute('sandbox', 'allow-same-origin');
    this.frame.referrerPolicy = 'no-referrer';
    this.frame.title = S.htmlPreview;
    this.frame.addEventListener('load', () => this.loaded());
    // A click into the frame takes the focus from the app's window. That's the last moment the
    // scroll position can be read before a rewritten link replaces the page.
    window.addEventListener('blur', this.noteScroll);
    host.append(this.note, this.frame);
  }

  private clickScroll: { top: number; left: number } | null = null;
  private noteScroll = () => {
    this.clickScroll = this.readScroll();
  };
  private lastText = '';
  /** An in-page link clicked in WebKit, to scroll to once the page is back. */
  private scrollTarget: string | null = null;

  /** Shows this text now, as at open or after a save. */
  show(): void {
    window.clearTimeout(this.timer);
    this.note.hidden = this.options.length() <= MAX_PREVIEW_CHARS;
    this.render(this.options.text());
  }

  /** After an edit: waits for typing to pause, and longer if the last update was slow. */
  schedule(): void {
    window.clearTimeout(this.timer);
    if (this.options.length() > MAX_PREVIEW_CHARS) {
      this.note.hidden = false;
      return;
    }
    this.note.hidden = true;
    const delay = this.cost > FRAME_BUDGET_MS ? Math.min(3000, this.cost * 4) : RENDER_DEBOUNCE_MS;
    this.timer = window.setTimeout(() => this.render(this.options.text()), Math.max(RENDER_DEBOUNCE_MS, delay));
  }

  /** Never while an update is still being laid out. Edits that arrive meanwhile show only the latest text. */
  private render(text: string, scroll = this.readScroll()): void {
    if (this.loading) {
      this.pending = text;
      return;
    }
    this.loading = true;
    this.lastText = text;
    this.scroll = scroll;
    this.started = performance.now();
    const rewrite = listenersWork === false;
    this.frame.srcdoc = withPolicy(rewrite ? rewriteLinks(text) : text, this.options.remoteImages, rewrite);
  }

  private scroll: { top: number; left: number } | null = null;
  private started = 0;

  private readScroll(): { top: number; left: number } | null {
    const scroller = this.frame.contentDocument?.scrollingElement;
    return scroller ? { top: scroller.scrollTop, left: scroller.scrollLeft } : null;
  }

  private loaded(): void {
    if (this.destroyed) return;
    const page = this.frame.contentDocument;
    const address = this.frame.contentWindow?.location.href ?? '';
    if (address.startsWith(LINK_PAGE)) {
      // A rewritten link was clicked: the same checks as any other, then the page back where it was.
      const href = decodeURIComponent(address.slice(LINK_PAGE.length));
      const kind = classifyLink(href);
      if (kind === 'external') this.options.openLink(href);
      this.scrollTarget = kind === 'anchor' ? decodeURIComponent(href.trim().slice(1)) : null;
      this.loading = false;
      this.render(this.pending ?? this.lastText, this.clickScroll ?? this.scroll);
      this.pending = null;
      return;
    }
    if (page && listenersWork === null && page.body) {
      let heard = false;
      const probe = () => (heard = true);
      page.addEventListener('full-probe', probe);
      page.body.dispatchEvent(new Event('full-probe', { bubbles: true }));
      page.removeEventListener('full-probe', probe);
      listenersWork = heard;
      if (!heard) {
        this.loading = false;
        this.render(this.pending ?? this.lastText, this.scroll);
        this.pending = null;
        return;
      }
    }
    if (page) {
      if (this.scroll) page.scrollingElement?.scrollTo(this.scroll.left, this.scroll.top);
      if (this.scrollTarget !== null) {
        (page.getElementById(this.scrollTarget) ?? page.getElementsByName(this.scrollTarget)[0])?.scrollIntoView();
        this.scrollTarget = null;
      }
      page.addEventListener('click', (event) => this.click(event, page), true);
      page.addEventListener('auxclick', (event) => this.click(event, page), true);
      page.addEventListener('keydown', (event) => {
        if (this.options.forwardKey(event)) event.preventDefault();
      });
    }
    this.cost = performance.now() - this.started;
    this.loading = false;
    if (this.pending !== null) {
      const next = this.pending;
      this.pending = null;
      this.render(next);
    }
  }

  /** Links go through the same checks as Markdown's. The frame itself never navigates. */
  private click(event: MouseEvent, page: Document): void {
    const anchor = (event.target as Element | null)?.closest?.('a[href]');
    if (!anchor) return;
    event.preventDefault();
    const href = anchor.getAttribute('href') ?? '';
    const kind = classifyLink(href);
    if (kind === 'anchor') {
      const id = decodeURIComponent(href.trim().slice(1));
      (page.getElementById(id) ?? page.getElementsByName(id)[0])?.scrollIntoView();
    } else if (kind === 'external') {
      this.options.openLink(href);
    }
  }

  destroy(): void {
    this.destroyed = true;
    window.removeEventListener('blur', this.noteScroll);
    window.clearTimeout(this.timer);
    this.frame.remove();
    this.note.remove();
  }
}
