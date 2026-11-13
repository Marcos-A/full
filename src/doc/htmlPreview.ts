import { MAX_HIGHLIGHT_CHARS, RENDER_DEBOUNCE_MS } from '../config';
import { classifyLink } from '../core/urls';
import { S } from '../strings';

/**
 * A read-only look at an HTML file, loaded with import() the first time one is shown. The browser
 * renders it in a sandboxed `<iframe srcdoc>`: with no `allow-scripts` nothing in the file runs,
 * and a strict policy at the top of the page keeps it from loading anything. `allow-same-origin`
 * on its own lets the app read the scroll position and catch link clicks, and nothing more, since
 * no script in the frame can use it.
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
export function withPolicy(html: string, remoteImages: boolean): string {
  const policy = `default-src 'none'; style-src 'unsafe-inline'; img-src data:${remoteImages ? ' https:' : ''}`;
  // WebKit doesn't run the app's listeners in a frame that can't run scripts, so it can't catch link
  // clicks there. With no allow-popups, this makes such a click do nothing instead of navigating away.
  const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}"><base target="_blank">`;
  const doctype = DOCTYPE.exec(html);
  return doctype ? doctype[0] + meta + html.slice(doctype[0].length) : meta + html;
}

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
    host.append(this.note, this.frame);
  }

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
  private render(text: string): void {
    if (this.loading) {
      this.pending = text;
      return;
    }
    this.loading = true;
    this.scroll = this.readScroll();
    this.started = performance.now();
    this.frame.srcdoc = withPolicy(text, this.options.remoteImages);
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
    if (page) {
      if (this.scroll) page.scrollingElement?.scrollTo(this.scroll.left, this.scroll.top);
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
    window.clearTimeout(this.timer);
    this.frame.remove();
    this.note.remove();
  }
}
