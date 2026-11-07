import { defaultValueCtx, Editor, editorViewCtx, editorViewOptionsCtx, parserCtx, prosePluginsCtx, rootCtx, serializerCtx } from '@milkdown/kit/core';
import { commonmark, imageSchema, linkAttr, syncHeadingIdPlugin } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import { Fragment, Node as ProseNode } from '@milkdown/kit/prose/model';
import { Plugin, PluginKey, Transaction } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { $view } from '@milkdown/kit/utils';
import { RENDER_DEBOUNCE_MS } from '../config';
import { splitBlocks } from '../core/markdownParts';
import { classifyImage, classifyLink } from '../core/urls';
import { S } from '../strings';

/** Set on every transaction the app itself makes. */
const APP_SYNC = 'full-app-sync';
const gateKey = new PluginKey('full-edit-gate');

/** Plugin bookkeeping (heading ids, list labels) is not a user edit, and neither is a load. */
function isUserEdit(tr: Transaction): boolean {
  return (
    tr.docChanged &&
    !tr.getMeta(APP_SYNC) &&
    tr.getMeta('addToHistory') !== false &&
    !tr.getMeta('appendedTransaction')
  );
}

export interface RenderedPaneOptions {
  root: HTMLElement;
  remoteImages: boolean;
  /** Whether the user has accepted the reformatting warning for this file. */
  canEdit: () => boolean;
  /** The user tried to change the document while it's read-only. */
  requestEdit: () => void;
  /** A real edit produced new Markdown. */
  onUserEdit: (markdown: string) => void;
  onFocus: () => void;
}

function imageNodeView(remoteImages: boolean) {
  return (node: ProseNode) => {
    const src = String(node.attrs.src ?? '');
    const alt = String(node.attrs.alt ?? '');
    const kind = classifyImage(src);
    let dom: HTMLElement;
    if (kind === 'data' || (kind === 'remote' && remoteImages)) {
      const img = document.createElement('img');
      img.alt = alt;
      if (node.attrs.title) img.title = String(node.attrs.title);
      img.referrerPolicy = 'no-referrer';
      img.src = src;
      dom = img;
    } else {
      dom = document.createElement('span');
      dom.className = 'md-image-placeholder';
      dom.setAttribute('data-image-state', kind);
      dom.textContent =
        kind === 'remote' ? S.imageBlocked(src) : kind === 'relative' ? S.imageRelative(src) : S.imageUnsafe(src);
    }
    return { dom, ignoreMutation: () => true };
  };
}

export class RenderedPane {
  private editor: Editor | null = null;
  private view: EditorView | null = null;
  private parse: ((markdown: string) => ProseNode) | null = null;
  private serialize: ((doc: ProseNode) => string) | null = null;
  private destroyed = false;
  private serializeTimer: number | undefined;
  /** The document after the last load, and its Markdown when it's first needed. */
  private baselineDoc: ProseNode | null = null;
  private baselineMarkdown: string | null = null;
  private pendingLoad: string | null = null;
  private loadTimer: number | undefined;
  private lastLoadCost = 0;
  private lastSerializeCost = 0;
  private blockCache = new Map<string, readonly ProseNode[]>();
  private loadToken = 0;
  /** The rendered side is behind the source, so edits there would overwrite newer text. */
  private loadInFlight = false;
  renderError = false;
  readonly ready: Promise<void>;

  constructor(private options: RenderedPaneOptions) {
    this.ready = this.create();
  }

  private async create(): Promise<void> {
    const { options } = this;
    const editor = Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, options.root);
        ctx.set(defaultValueCtx, '');
        ctx.set(linkAttr.key, () => ({ target: '_blank', rel: 'noopener noreferrer' }));
        ctx.update(editorViewOptionsCtx, (prev) => ({
          ...prev,
          attributes: { 'aria-label': S.rendered, 'aria-multiline': 'true', spellcheck: 'false' },
          dispatchTransaction: (tr: Transaction) => this.dispatch(tr),
          handleDOMEvents: {
            beforeinput: (_view, event) => this.blockIfReadOnly(event),
            compositionstart: (view, event) => {
              if (this.options.canEdit()) return false;
              event.preventDefault();
              view.dom.blur();
              this.options.requestEdit();
              return true;
            },
            focus: () => {
              this.options.onFocus();
              return false;
            },
            click: (_view, event) => this.handleLinkClick(event),
          },
          handleClickOn: (view, _pos, node, nodePos, event) => this.handleTaskClick(view, node, nodePos, event),
        }));
        ctx.update(prosePluginsCtx, (plugins) => [
          ...plugins,
          new Plugin({
            key: gateKey,
            filterTransaction: (tr) => {
              if (!isUserEdit(tr)) return true;
              if (this.loadInFlight) return false;
              if (this.options.canEdit()) return true;
              this.options.requestEdit();
              return false;
            },
          }),
        ]);
      })
      // Heading ids aren't used, and that plugin rewrites every heading on every change.
      .use(commonmark.filter((plugin) => plugin !== syncHeadingIdPlugin))
      .use(gfm)
      .use($view(imageSchema.node, () => imageNodeView(options.remoteImages)));
    await editor.create();
    if (this.destroyed) {
      await editor.destroy();
      return;
    }
    this.editor = editor;
    editor.action((ctx) => {
      this.view = ctx.get(editorViewCtx);
      this.parse = ctx.get(parserCtx);
      this.serialize = ctx.get(serializerCtx);
    });
  }

  private blockIfReadOnly(event: Event): boolean {
    if (this.loadInFlight) {
      event.preventDefault();
      return true;
    }
    if (this.options.canEdit()) return false;
    event.preventDefault();
    this.options.requestEdit();
    return true;
  }

  private dispatch(tr: Transaction): void {
    const view = this.view ?? this.lateView();
    if (!view) return;
    const before = view.state.doc;
    view.updateState(view.state.apply(tr));
    if (view.state.doc === before || !isUserEdit(tr)) return;
    window.clearTimeout(this.serializeTimer);
    const delay = Math.min(3000, Math.max(RENDER_DEBOUNCE_MS, this.lastSerializeCost * 3));
    this.serializeTimer = window.setTimeout(() => this.flushEdit(), delay);
  }

  /** Plugins may dispatch while the view is being built, before create() has returned. */
  private lateView(): EditorView | null {
    let found: EditorView | null = null;
    this.editor?.action((ctx) => {
      found = ctx.get(editorViewCtx);
    });
    return found;
  }

  private handleLinkClick(event: MouseEvent): boolean {
    const anchor = (event.target as HTMLElement | null)?.closest?.('a');
    if (!anchor) return false;
    event.preventDefault();
    // Once edits are accepted a plain click places the caret; Cmd/Ctrl+click still follows the link.
    if (this.options.canEdit() && !(event.metaKey || event.ctrlKey)) return true;
    const href = anchor.getAttribute('href') ?? '';
    if (classifyLink(href) === 'external') window.open(href, '_blank', 'noopener,noreferrer');
    return true;
  }

  private handleTaskClick(view: EditorView, node: ProseNode, pos: number, event: MouseEvent): boolean {
    if (node.type.name !== 'list_item' || node.attrs.checked === null || node.attrs.checked === undefined) return false;
    if (!(event.target as HTMLElement).matches('li[data-item-type="task"]')) return false;
    view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: !node.attrs.checked }));
    return true;
  }

  /** Write a pending rendered edit to the source now, if the Markdown really changed. */
  flushEdit(): void {
    if (this.serializeTimer === undefined) return;
    window.clearTimeout(this.serializeTimer);
    this.serializeTimer = undefined;
    const { view, serialize } = this;
    if (!view || !serialize) return;
    const started = performance.now();
    if (this.baselineMarkdown === null) {
      this.baselineMarkdown = this.baselineDoc ? serialize(this.baselineDoc) : null;
    }
    const markdown = serialize(view.state.doc);
    this.lastSerializeCost = performance.now() - started;
    if (markdown === this.baselineMarkdown) return;
    this.baselineMarkdown = markdown;
    this.baselineDoc = view.state.doc;
    this.options.onUserEdit(markdown);
  }

  /** Costly documents wait for typing to pause, so loading never competes with keystrokes. */
  scheduleLoad(markdown: string): void {
    this.pendingLoad = markdown;
    window.clearTimeout(this.loadTimer);
    const delay = Math.min(3000, Math.max(RENDER_DEBOUNCE_MS, this.lastLoadCost * 4));
    this.loadTimer = window.setTimeout(() => this.flushLoad(), delay);
  }

  flushLoad(): void {
    window.clearTimeout(this.loadTimer);
    const markdown = this.pendingLoad;
    this.pendingLoad = null;
    if (markdown !== null) this.load(markdown);
  }

  /**
   * Parsing is quadratic in the number of lists, so big files parse section by section, and a
   * section that didn't change reuses its nodes. The identical nodes also make the diff instant.
   * Parsing yields between sections, so a first load doesn't hold up typing.
   */
  private async parseSections(blocks: string[], token: number): Promise<ProseNode | null> {
    const next = new Map<string, readonly ProseNode[]>();
    const nodes: ProseNode[] = [];
    let sliceStart = performance.now();
    for (const block of blocks) {
      let parsed = next.get(block) ?? this.blockCache.get(block);
      if (!parsed) {
        if (performance.now() - sliceStart > 12) {
          await new Promise((resolve) => setTimeout(resolve));
          if (token !== this.loadToken || !this.parse) return null;
          sliceStart = performance.now();
        }
        const children: ProseNode[] = [];
        this.parse!(block).forEach((child) => children.push(child));
        parsed = children;
        // Kept even if this load is superseded: most sections will be wanted by the next one.
        this.blockCache.set(block, parsed);
      }
      next.set(block, parsed);
      nodes.push(...parsed);
    }
    this.blockCache = next;
    return this.view!.state.schema.topNodeType.create(null, Fragment.fromArray(nodes));
  }

  /** Load source text. This never writes Markdown back: see isUserEdit and APP_SYNC. */
  load(markdown: string): void {
    const { view, parse } = this;
    if (!view || !parse) {
      this.pendingLoad = markdown;
      return;
    }
    const token = ++this.loadToken;
    const blocks = splitBlocks(markdown);
    if (blocks.length < 2) {
      this.loadInFlight = false;
      this.blockCache = new Map();
      this.applyLoaded(() => parse(markdown));
      return;
    }
    this.loadInFlight = true;
    void this.parseSections(blocks, token).then((parsed) => {
      if (!parsed || token !== this.loadToken || this.destroyed) return;
      this.loadInFlight = false;
      this.applyLoaded(() => parsed);
    });
  }

  private applyLoaded(produce: () => ProseNode): void {
    const view = this.view!;
    const started = performance.now();
    try {
      const parsed = produce();
      const current = view.state.doc;
      const start = current.content.findDiffStart(parsed.content);
      if (start !== null) {
        let { a, b } = current.content.findDiffEnd(parsed.content)!;
        const overlap = start - Math.min(a, b);
        if (overlap > 0) {
          a += overlap;
          b += overlap;
        }
        const tr = view.state.tr.replace(start, a, parsed.slice(start, b));
        tr.setMeta(APP_SYNC, true).setMeta('addToHistory', false);
        view.dispatch(tr);
      }
      this.baselineDoc = view.state.doc;
      this.baselineMarkdown = null;
      this.renderError = false;
    } catch (error) {
      console.error(error);
      this.renderError = true;
    }
    this.lastLoadCost = performance.now() - started;
  }

  get dom(): HTMLElement | null {
    return this.view?.dom ?? null;
  }

  focus(): void {
    this.view?.focus();
  }

  destroy(): void {
    this.destroyed = true;
    this.loadToken++;
    window.clearTimeout(this.serializeTimer);
    window.clearTimeout(this.loadTimer);
    void this.editor?.destroy();
  }
}
