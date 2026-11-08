import { parseCsv } from '../core/csv';
import { CsvModel } from '../core/csvModel';
import { parseCsvFile } from '../core/csvParse';
import { decodeAs, detectAndDecode, EncodingName } from '../core/encoding';
import type { DocKind } from '../core/fileTypes';
import { detectLineEndings, eolString, fromEditorText, LineEnding, PureEnding, toEditorText } from '../core/lineEndings';
import { joinRenderedMarkdown, splitFrontMatter } from '../core/markdownParts';
import { FileBinding, Revision, storedBinding } from '../platform/host';
import type { DocumentRecord } from '../recovery/store';
import { RenderedPane } from './RenderedPane';
import { SourcePane } from './SourcePane';

export type MarkdownView = 'split' | 'source' | 'rendered';

export interface OpenDocInit {
  id: string;
  name: string;
  kind: DocKind;
  binding?: FileBinding;
  originalBytes: ArrayBuffer;
  encoding: EncodingName;
  hasBom: boolean;
  lossy: boolean;
  fileSize: number;
  fileLastModified: number;
  lastSavedText: string;
  currentText: string;
  delimiter?: string;
}

const LARGE_TABLE_ROWS = 20_000;

/** One open file: what it holds, how it maps to bytes on disk, and its editor panes. */
export class OpenDoc {
  readonly id: string;
  readonly kind: DocKind;
  name: string;
  binding?: FileBinding;
  originalBytes: ArrayBuffer;
  encoding: EncodingName;
  hasBom: boolean;
  lossy: boolean;
  lineEnding: LineEnding = 'lf';
  dominant: PureEnding = 'lf';
  fileSize: number;
  fileLastModified: number;
  lastSavedText: string;
  private savedEditorText: string;
  dirty = false;

  source: SourcePane | null = null;
  rendered: RenderedPane | null = null;
  frontMatter = '';
  viewMode: MarkdownView = 'split';
  remoteImages = false;
  renderedAccepted = false;
  splitRatio = 0.5;
  wrap = true;
  /** The rendered side needs loading once it's visible again. */
  private renderStale = false;

  csv: CsvModel | null = null;
  csvMode: 'grid' | 'raw' = 'grid';
  csvErrorLine: number | null = null;
  headerRow = true;
  /** The file-form text when raw view was entered, to tell whether raw view changed anything. */
  private rawEntryText = '';
  private rawEntryEditorText = '';
  private rawParseTimer: number | undefined;
  private dirtyTimer: number | undefined;
  gridApi: GridApi | null = null;
  columnWidths: number[] = [];

  closed = false;
  persistChain: Promise<void> = Promise.resolve();
  /** Anything that needs saving to the recovery store changed. */
  onContentChange: () => void = () => undefined;
  /** Anything shown in the interface changed. */
  onUiChange: () => void = () => undefined;
  canEditRendered: (doc: OpenDoc) => boolean = () => false;
  requestRenderedEdit: (doc: OpenDoc) => void = () => undefined;

  private constructor(init: OpenDocInit) {
    this.id = init.id;
    this.kind = init.kind;
    this.name = init.name;
    this.binding = init.binding;
    this.originalBytes = init.originalBytes;
    this.encoding = init.encoding;
    this.hasBom = init.hasBom;
    this.lossy = init.lossy;
    this.fileSize = init.fileSize;
    this.fileLastModified = init.fileLastModified;
    this.lastSavedText = init.lastSavedText;
    this.savedEditorText = toEditorText(init.lastSavedText);
    this.refreshLineEndings();
  }

  static async create(init: OpenDocInit): Promise<OpenDoc> {
    const doc = new OpenDoc(init);
    if (init.kind === 'csv') await doc.loadCsv(init.currentText, init.delimiter);
    else doc.createSourcePane(init.currentText);
    doc.dirty = doc.currentText() !== doc.lastSavedText;
    return doc;
  }

  /** Created in the app and never saved anywhere yet. */
  get isNew(): boolean {
    return !this.binding && this.fileLastModified === 0;
  }

  private refreshLineEndings(): void {
    const info = detectLineEndings(this.lastSavedText);
    this.lineEnding = info.ending;
    this.dominant = info.dominant;
  }

  private createSourcePane(text: string): void {
    const editorText = toEditorText(text);
    this.source?.destroy();
    this.source = new SourcePane({
      text: editorText,
      markdown: this.kind === 'markdown',
      wrap: this.kind !== 'csv' && this.wrap,
      onChange: (fromRendered) => this.sourceChanged(fromRendered),
      onFocus: () => this.rendered?.flushEdit(),
    });
    if (this.kind === 'markdown') this.frontMatter = splitFrontMatter(editorText).frontMatter;
  }

  private async loadCsv(text: string, delimiter?: string): Promise<void> {
    const parsed = await parseCsvFile(text, delimiter);
    this.csv = new CsvModel(parsed.rows, parsed.delimiter, eolString(this.dominant));
    if (parsed.error) {
      this.csvErrorLine = parsed.error.line;
      this.enterRaw(text);
    } else {
      this.csvErrorLine = null;
      this.csvMode = 'grid';
    }
  }

  private enterRaw(text: string): void {
    this.rawEntryText = text;
    this.rawEntryEditorText = toEditorText(text);
    this.csvMode = 'raw';
    this.createSourcePane(text);
  }

  /** The file form of the current content: what an edited save encodes. */
  currentText(): string {
    if (this.kind === 'csv' && this.csvMode === 'grid') return this.csv!.text();
    const text = this.source!.text();
    if (this.kind === 'csv') {
      return text === this.rawEntryEditorText ? this.rawEntryText : fromEditorText(text, this.dominant);
    }
    return text === this.savedEditorText ? this.lastSavedText : fromEditorText(text, this.dominant);
  }

  private sourceChanged(fromRendered: boolean): void {
    if (this.kind === 'markdown') {
      const text = this.source!.text();
      const frontMatter = splitFrontMatter(text).frontMatter;
      const frontChanged = frontMatter !== this.frontMatter;
      this.frontMatter = frontMatter;
      if (frontChanged) this.onUiChange();
      if (!fromRendered) this.scheduleRender();
    }
    if (this.kind === 'csv') this.scheduleRawParse();
    this.contentChanged();
  }

  /** Comparing a large table's text on every edit would be wasteful, so that check is deferred. */
  private contentChanged(): void {
    const large = this.kind === 'csv' && this.csvMode === 'grid' && this.csv!.rows.length > LARGE_TABLE_ROWS;
    if (large) {
      this.setDirty(true);
      window.clearTimeout(this.dirtyTimer);
      this.dirtyTimer = window.setTimeout(() => this.setDirty(this.currentText() !== this.lastSavedText), 150);
    } else {
      this.setDirty(this.currentText() !== this.lastSavedText);
    }
    this.onContentChange();
  }

  private setDirty(dirty: boolean): void {
    if (dirty === this.dirty) return;
    this.dirty = dirty;
    this.onUiChange();
  }

  isDirty(): boolean {
    return this.currentText() !== this.lastSavedText;
  }

  // ---- Markdown: the source is the single source of truth ----

  markdownBody(): string {
    return splitFrontMatter(this.source!.text()).body;
  }

  attachRendered(pane: RenderedPane): void {
    this.rendered = pane;
    void pane.ready.then(() => {
      if (this.rendered === pane) pane.load(this.markdownBody());
    });
  }

  detachRendered(pane: RenderedPane): void {
    pane.destroy();
    if (this.rendered === pane) this.rendered = null;
  }

  private scheduleRender(): void {
    if (this.viewMode === 'source') {
      this.renderStale = true;
      return;
    }
    this.rendered?.scheduleLoad(this.markdownBody());
  }

  applyRenderedMarkdown(markdown: string): void {
    const source = this.source!;
    source.applyText(joinRenderedMarkdown(source.text(), markdown), { fromRendered: true });
  }

  /** Bring both sides up to date, so that what's saved includes everything typed so far. */
  flushEditors(): void {
    this.rendered?.flushEdit();
    if (this.dirtyTimer !== undefined) {
      window.clearTimeout(this.dirtyTimer);
      this.dirtyTimer = undefined;
    }
    window.clearTimeout(this.rawParseTimer);
  }

  setViewMode(mode: MarkdownView): void {
    this.flushEditors();
    this.viewMode = mode;
    if (mode !== 'source' && this.renderStale) {
      this.renderStale = false;
      this.rendered?.load(this.markdownBody());
    }
    this.onUiChange();
    requestAnimationFrame(() => this.source?.view.requestMeasure());
  }

  setRemoteImages(allow: boolean): void {
    this.flushEditors();
    this.remoteImages = allow;
    this.onUiChange();
  }

  setWrap(wrap: boolean): void {
    this.wrap = wrap;
    this.source?.setWrap(wrap);
    this.onUiChange();
  }

  // ---- CSV ----

  gridEdited(): void {
    this.onUiChange();
    this.contentChanged();
  }

  private scheduleRawParse(): void {
    window.clearTimeout(this.rawParseTimer);
    this.rawParseTimer = window.setTimeout(() => this.parseRaw(), 300);
  }

  private parseRaw(): void {
    if (this.kind !== 'csv' || this.csvMode !== 'raw') return;
    const parsed = parseCsv(this.currentText(), this.csv!.delimiter);
    this.csvErrorLine = parsed.error ? parsed.error.line : null;
    this.rawRowCount = parsed.error ? null : parsed.rows.length;
    this.rawColumnCount = parsed.error ? null : parsed.rows.reduce((m, r) => Math.max(m, r.fields.length), 0);
    this.onUiChange();
  }
  rawRowCount: number | null = null;
  rawColumnCount: number | null = null;

  /** Returns the problem line if the raw text can't be shown as a table. */
  setCsvMode(mode: 'grid' | 'raw'): number | null {
    if (mode === this.csvMode) return null;
    window.clearTimeout(this.rawParseTimer);
    if (mode === 'raw') {
      this.enterRaw(this.csv!.text());
      this.rawRowCount = this.csv!.rows.length;
      this.rawColumnCount = this.csv!.columnCount;
      this.onUiChange();
      return null;
    }
    const text = this.currentText();
    if (text !== this.rawEntryText || this.csvErrorLine !== null || text !== this.csv!.text()) {
      const parsed = parseCsv(text, this.csv!.delimiter);
      if (parsed.error) {
        this.csvErrorLine = parsed.error.line;
        this.onUiChange();
        return parsed.error.line;
      }
      // The raw edits arrive in the table as one undoable change.
      if (text !== this.csv!.text()) this.csv!.replaceAll(parsed.rows);
      this.csvErrorLine = null;
    }
    this.csvMode = 'grid';
    this.source?.destroy();
    this.source = null;
    this.contentChanged();
    this.onUiChange();
    return null;
  }

  /** Returns false if the file can't be tokenized with this delimiter. */
  setDelimiter(delimiter: string): boolean {
    const csv = this.csv!;
    if (this.csvMode === 'raw') {
      const parsed = parseCsv(this.currentText(), delimiter);
      csv.delimiter = delimiter;
      this.csvErrorLine = parsed.error ? parsed.error.line : null;
      this.onUiChange();
      this.onContentChange();
      return parsed.error === null;
    }
    if (!csv.reparseWith(delimiter)) return false;
    this.columnWidths = [];
    this.onUiChange();
    this.onContentChange();
    return true;
  }

  // ---- Undo, revert, reopen ----

  undo(): void {
    this.flushEditors();
    if (this.kind === 'csv' && this.csvMode === 'grid') {
      if (this.csv!.undo()) this.gridEdited();
    } else if (this.source?.undo()) {
      this.rendered?.flushLoad();
    }
  }

  redo(): void {
    this.flushEditors();
    if (this.kind === 'csv' && this.csvMode === 'grid') {
      if (this.csv!.redo()) this.gridEdited();
    } else if (this.source?.redo()) {
      this.rendered?.flushLoad();
    }
  }

  /** Restores the saved text exactly. Goes through the undo history, so it can be undone. */
  revert(): void {
    this.flushEditors();
    if (this.kind === 'csv' && this.csvMode === 'grid') {
      const parsed = parseCsv(this.lastSavedText, this.csv!.delimiter);
      if (parsed.error) {
        this.csvErrorLine = parsed.error.line;
        this.enterRaw(this.lastSavedText);
      } else {
        this.csv!.replaceAll(parsed.rows);
      }
      this.gridEdited();
      return;
    }
    if (this.kind === 'csv') this.rawEntryText = this.lastSavedText;
    if (this.kind === 'csv') this.rawEntryEditorText = this.savedEditorText;
    this.source!.applyText(this.savedEditorText);
    this.rendered?.flushLoad();
  }

  async reopenAs(encoding: EncodingName): Promise<void> {
    const decoded = decodeAs(new Uint8Array(this.originalBytes), encoding);
    this.encoding = encoding;
    this.hasBom = decoded.hasBom;
    this.lossy = decoded.lossy;
    this.lastSavedText = decoded.text;
    this.savedEditorText = toEditorText(decoded.text);
    this.refreshLineEndings();
    if (this.kind === 'csv') {
      this.source?.destroy();
      this.source = null;
      await this.loadCsv(decoded.text, this.csv?.delimiter);
    } else {
      this.createSourcePane(decoded.text);
      if (this.rendered) this.rendered.load(this.markdownBody());
    }
    this.dirty = false;
    this.onUiChange();
    this.onContentChange();
  }

  /** Starts over from what's now on disk, as if the file had just been opened. */
  async reload(bytes: ArrayBuffer, revision: Revision): Promise<void> {
    this.originalBytes = bytes;
    this.fileSize = revision.size;
    this.fileLastModified = revision.modifiedMs;
    await this.reopenAs(detectAndDecode(new Uint8Array(bytes)).encoding);
  }

  /** The file on disk now matches these bytes and this text. */
  markSaved(info: {
    bytes: Uint8Array;
    text: string;
    encoding: EncodingName;
    hasBom: boolean;
    name?: string;
    binding?: FileBinding;
    fileLastModified?: number;
  }): void {
    this.originalBytes = info.bytes.slice().buffer as ArrayBuffer;
    this.lastSavedText = info.text;
    this.savedEditorText = toEditorText(info.text);
    this.encoding = info.encoding;
    this.hasBom = info.hasBom;
    this.fileSize = info.bytes.length;
    if (info.fileLastModified !== undefined) this.fileLastModified = info.fileLastModified;
    else if (this.isNew) this.fileLastModified = Date.now();
    if (info.name) this.name = info.name;
    if (info.binding) this.binding = info.binding;
    this.lossy = false;
    this.refreshLineEndings();
    if (this.csv) this.csv.eol = eolString(this.dominant);
    this.dirty = false;
    this.onUiChange();
    this.onContentChange();
  }

  toRecord(sessionId: string): DocumentRecord {
    const currentText = this.currentText();
    return {
      id: this.id,
      sessionId,
      name: this.name,
      kind: this.kind,
      ...storedBinding(this.binding),
      originalBytes: this.originalBytes,
      currentText,
      lastSavedText: this.lastSavedText,
      hasUnsavedChanges: currentText !== this.lastSavedText,
      encoding: this.encoding,
      hasBom: this.hasBom,
      lineEnding: this.lineEnding,
      delimiter: this.csv?.delimiter,
      fileSize: this.fileSize,
      fileLastModified: this.fileLastModified,
      updatedAt: Date.now(),
    };
  }

  focus(): void {
    if (this.kind === 'csv' && this.csvMode === 'grid') this.gridApi?.focus();
    else if (this.viewMode === 'rendered' && this.kind === 'markdown') this.rendered?.focus();
    else this.source?.focus();
  }

  destroy(): void {
    this.closed = true;
    window.clearTimeout(this.dirtyTimer);
    window.clearTimeout(this.rawParseTimer);
    this.rendered?.destroy();
    this.source?.destroy();
  }
}

/** What the commands need from the mounted grid. */
export interface GridApi {
  focus(): void;
  selectionValues(): string[][];
  allValues(): string[][];
  cutSelection(): void;
  pasteText(text: string): void;
  insertRow(where: 'above' | 'below'): void;
  deleteRows(): void;
  insertColumn(where: 'left' | 'right'): void;
  deleteColumns(): void;
  moveRows(direction: -1 | 1): void;
  moveColumns(direction: -1 | 1): void;
  selectAll(): void;
}
