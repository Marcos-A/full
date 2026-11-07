import { LARGE_FILE_WARNING, MAX_RECOVERY_ENTRIES, PERSIST_DEBOUNCE_MS } from '../config';
import { toHtmlTable, toTsv } from '../core/clipboardTable';
import { detectAndDecode, encodeText, EncodingName, ENCODING_LABELS, findUnencodable } from '../core/encoding';
import { DocKind, kindFromName } from '../core/fileTypes';
import { acquireSessionLock, liveSessions, sessionId, watchSession } from '../recovery/session';
import {
  allRecords,
  claimRecord,
  deleteAbandoned,
  deleteRecord,
  DocumentRecord,
  putRecord,
  selectEvictions,
} from '../recovery/store';
import { browserLanguage, Language, LANGUAGE_KEY, S, setLanguage } from '../strings';
import { writeClipboard } from '../platform/clipboard';
import { bindingFromStored, host, PickedFile, storedBinding } from '../platform/host';
import { faviconFor } from '../ui/Logo';
import { OpenDoc } from './OpenDoc';

export interface Notice {
  id: number;
  kind: 'info' | 'error';
  text: string;
}

export interface DialogAction {
  id: string;
  label: string;
  primary?: boolean;
  danger?: boolean;
}

export interface DialogRequest {
  title: string;
  body: string;
  actions: DialogAction[];
  /** Returned when dismissed with Escape. */
  cancelId: string;
  /** Returned when Enter is pressed in the text field, instead of the primary action. */
  enterAction?: string;
  checkbox?: string;
  input?: { label: string; value: string };
  resolve: (result: DialogResult) => void;
}

export interface DialogResult {
  action: string;
  checked: boolean;
  value: string;
}

export type RecoveryEntry = Omit<DocumentRecord, 'originalBytes' | 'currentText' | 'lastSavedText' | 'handle' | 'nativePath'>;

export type ThemeChoice = 'system' | 'dark' | 'light';

/** In colour-wheel order, which is how the palette lists them. The default comes first. */
export const ACCENTS = ['violet', 'blue', 'green', 'orange', 'coral'] as const;
export type Accent = (typeof ACCENTS)[number];
/** The brand colour: the tone drawn into the files in public/, and the CSS tokens' default. */
const DEFAULT_ACCENT: Accent = 'violet';

const NEW_FILE_ENDINGS: Record<DocKind, string> = { markdown: '.md', csv: '.csv', text: '.txt' };

const ACCENT_KEY = 'full.accent';
const THEME_KEY = 'full.theme';
const SKIP_REFORMAT_KEY = 'full.skipReformatWarning';
const BROWSER_NOTICE_KEY = 'full.browserNoticeDismissed';

function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function storageSet(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Preferences simply don't persist in this case.
  }
}

class Workspace {
  docs: OpenDoc[] = [];
  activeId: string | null = null;
  notices: Notice[] = [];
  dialog: DialogRequest | null = null;
  recovery: RecoveryEntry[] = [];
  recoveryDialogOpen = false;
  recoveryBannerDismissed = false;
  paletteQuery: string | null = null;
  storageProblem = false;
  browserNotice = false;
  theme: ThemeChoice = 'system';
  accent: Accent = DEFAULT_ACCENT;

  private version = 0;
  private listeners = new Set<() => void>();
  private dialogQueue: DialogRequest[] = [];
  private persistTimers = new Map<OpenDoc, number>();
  private watched = new Set<string>();
  private channel: BroadcastChannel | null = null;
  private nextNoticeId = 1;
  private reformatPrompt: Promise<void> | null = null;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getVersion = (): number => this.version;
  bump(): void {
    this.version++;
    this.listeners.forEach((listener) => listener());
  }

  get active(): OpenDoc | null {
    return this.docs.find((d) => d.id === this.activeId) ?? null;
  }

  // ---- Startup ----

  async start(): Promise<void> {
    const stored = storageGet(THEME_KEY);
    this.applyTheme(stored === 'dark' || stored === 'light' ? stored : 'system');
    const accent = storageGet(ACCENT_KEY) as Accent | null;
    if (accent && ACCENTS.includes(accent)) this.applyAccent(accent);
    this.browserNotice = !host().canOverwrite && storageGet(BROWSER_NOTICE_KEY) === null;
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => this.bump());

    await acquireSessionLock();
    void navigator.storage?.persist?.();

    if ('BroadcastChannel' in window) {
      this.channel = new BroadcastChannel('full-recovery');
      this.channel.onmessage = () => void this.refreshRecovery();
    }
    window.addEventListener('focus', () => void this.refreshRecovery());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void this.flushPersistence();
      else void this.refreshRecovery();
    });
    window.addEventListener('pagehide', () => void this.flushPersistence());
    window.addEventListener('beforeunload', (event) => {
      if (this.docs.some((d) => d.dirty)) event.preventDefault();
    });
    window.setInterval(() => {
      if (document.visibilityState === 'visible') void this.refreshRecovery();
    }, 5000);
    await this.refreshRecovery();
  }

  // ---- Notices and dialogs ----

  notify(kind: Notice['kind'], text: string): void {
    const id = this.nextNoticeId++;
    this.notices = [...this.notices, { id, kind, text }];
    this.bump();
    if (kind === 'info') window.setTimeout(() => this.dismissNotice(id), 4000);
  }

  dismissNotice(id: number): void {
    const next = this.notices.filter((n) => n.id !== id);
    if (next.length === this.notices.length) return;
    this.notices = next;
    this.bump();
  }

  ask(request: Omit<DialogRequest, 'resolve'>): Promise<DialogResult> {
    return new Promise((resolve) => {
      const full = { ...request, resolve };
      if (this.dialog) this.dialogQueue.push(full);
      else this.dialog = full;
      this.bump();
    });
  }

  finishDialog(result: DialogResult): void {
    const current = this.dialog;
    this.dialog = this.dialogQueue.shift() ?? null;
    this.bump();
    current?.resolve(result);
    if (!this.dialog) requestAnimationFrame(() => this.active?.focus());
  }

  // ---- Theme ----

  applyTheme(choice: ThemeChoice): void {
    this.theme = choice;
    if (choice === 'system') {
      delete document.documentElement.dataset.theme;
      storageSet(THEME_KEY, null);
    } else {
      document.documentElement.dataset.theme = choice;
      storageSet(THEME_KEY, choice);
    }
    this.bump();
  }

  applyAccent(accent: Accent): void {
    this.accent = accent;
    if (accent === DEFAULT_ACCENT) {
      delete document.documentElement.dataset.accent;
      storageSet(ACCENT_KEY, null);
    } else {
      document.documentElement.dataset.accent = accent;
      storageSet(ACCENT_KEY, accent);
    }
    this.updateFavicon();
    this.bump();
  }

  /** The file in public/ is the default tone. Other tones are drawn on request. */
  private updateFavicon(): void {
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"][type="image/svg+xml"]');
    if (!link) return;
    const tone = getComputedStyle(document.documentElement).getPropertyValue('--a-dark').trim();
    link.href = this.accent === DEFAULT_ACCENT ? '/favicon.svg' : faviconFor(tone);
  }

  /** What's on screen now, whichever way it was chosen. */
  effectiveTheme(): 'dark' | 'light' {
    return this.theme !== 'system' ? this.theme : this.systemTheme();
  }

  private systemTheme(): 'dark' | 'light' {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }

  /** Choosing the theme the system already has means following the system again, not pinning it. */
  toggleTheme(): void {
    const next = this.effectiveTheme() === 'dark' ? 'light' : 'dark';
    this.applyTheme(next === this.systemTheme() ? 'system' : next);
  }

  // ---- Language ----

  /** Like the theme, choosing the browser's own language means following the browser again. */
  applyLanguage(language: Language): void {
    for (const doc of this.docs) doc.flushEditors();
    setLanguage(language);
    document.documentElement.lang = language;
    storageSet(LANGUAGE_KEY, language === browserLanguage() ? null : language);
    for (const doc of this.docs) doc.source?.localize();
    this.bump();
  }

  dismissBrowserNotice(): void {
    this.browserNotice = false;
    storageSet(BROWSER_NOTICE_KEY, '1');
    this.bump();
  }

  // ---- Opening ----

  async openPicked(): Promise<void> {
    try {
      await this.openFiles(await host().pickFiles());
    } catch (error) {
      this.notify('error', String(error));
    }
  }

  dropped(data: DataTransfer): void {
    void host().filesFromDrop(data).then((files) => this.openFiles(files));
  }

  async openFiles(files: PickedFile[]): Promise<void> {
    for (const picked of files) {
      try {
        await this.openOne(picked);
      } catch (error) {
        console.error(error);
        this.notify('error', S.readFailed(picked.file.name));
      }
    }
  }

  private async findDuplicate({ file, binding }: PickedFile): Promise<OpenDoc | null> {
    for (const doc of this.docs) {
      if (binding && doc.binding) {
        if (await host().isSame(binding, doc.binding)) return doc;
      } else if (doc.name === file.name && doc.fileSize === file.size && doc.fileLastModified === file.lastModified) {
        return doc;
      }
    }
    return null;
  }

  private async openOne(picked: PickedFile): Promise<void> {
    const { file, binding } = picked;
    const kind = kindFromName(file.name);
    if (!kind) {
      this.notify('error', S.unsupported(file.name));
      return;
    }
    const duplicate = await this.findDuplicate(picked);
    if (duplicate) {
      this.activate(duplicate.id);
      return;
    }
    if (file.size > LARGE_FILE_WARNING) this.notify('error', S.largeFile(file.name));

    const originalBytes = await file.arrayBuffer();
    const decoded = detectAndDecode(new Uint8Array(originalBytes));
    const id = crypto.randomUUID();

    // The record exists before anything is rendered, so a crash while opening is recoverable.
    await this.writeRecord({
      id,
      sessionId,
      name: file.name,
      kind,
      ...storedBinding(binding),
      originalBytes,
      currentText: decoded.text,
      lastSavedText: decoded.text,
      hasUnsavedChanges: false,
      encoding: decoded.encoding,
      hasBom: decoded.hasBom,
      lineEnding: 'lf',
      fileSize: file.size,
      fileLastModified: file.lastModified,
      updatedAt: Date.now(),
    });

    const doc = await OpenDoc.create({
      id,
      name: file.name,
      kind,
      binding,
      originalBytes,
      encoding: decoded.encoding,
      hasBom: decoded.hasBom,
      lossy: decoded.lossy,
      fileSize: file.size,
      fileLastModified: file.lastModified,
      lastSavedText: decoded.text,
      currentText: decoded.text,
    });
    this.addDoc(doc);
    this.reportMalformed(doc);
    this.schedulePersist(doc);
    this.broadcast();
  }

  /** Without a type, the dialog offers all three. */
  async newFile(chosen?: DocKind): Promise<void> {
    const stems = new Set(this.docs.map((d) => d.name.replace(/\.[^.]*$/, '')));
    let stem = 'untitled';
    for (let i = 2; stems.has(stem); i++) stem = `untitled-${i}`;

    const result = await this.ask({
      title: S.newFile,
      body: chosen ? '' : S.newFileBody,
      input: { label: S.fileNameLabel, value: chosen ? stem + NEW_FILE_ENDINGS[chosen] : stem },
      actions: chosen
        ? [
            { id: 'cancel', label: S.cancel },
            { id: chosen, label: S.create, primary: true },
          ]
        : [
            { id: 'cancel', label: S.cancel },
            { id: 'text', label: S.kindNames.text },
            { id: 'csv', label: S.kindNames.csv },
            { id: 'markdown', label: S.kindNames.markdown, primary: true },
          ],
      // Pressing Enter on a name that already ends in .csv means that type, not the default button.
      enterAction: chosen ? undefined : 'typed',
      cancelId: 'cancel',
    });
    if (result.action === 'cancel') return;
    const typed = result.value.trim();
    const typedKind = kindFromName(typed);
    const kind: DocKind = result.action === 'typed' ? (typedKind ?? 'markdown') : (result.action as DocKind);
    const base = typedKind ? typed.slice(0, typed.lastIndexOf('.')) : typed;
    const name = (base || stem) + NEW_FILE_ENDINGS[kind];

    // A new CSV opens as a small table to type into. It follows what Excel expects in this locale:
    // a semicolon where the decimal mark is a comma, CRLF, and a BOM so accents display correctly.
    const decimalComma = (1.5).toLocaleString().includes(',');
    const delimiter = decimalComma ? ';' : ',';
    const isCsv = kind === 'csv';
    const text = isCsv ? `${delimiter}${delimiter}\r\n`.repeat(2) : '';
    const bytes = encodeText(text, 'utf-8', isCsv);
    const doc = await OpenDoc.create({
      id: crypto.randomUUID(),
      name,
      kind,
      originalBytes: bytes.slice().buffer as ArrayBuffer,
      encoding: 'utf-8',
      hasBom: isCsv,
      lossy: false,
      fileSize: bytes.length,
      fileLastModified: 0,
      lastSavedText: text,
      currentText: text,
      delimiter: isCsv ? delimiter : undefined,
    });
    this.addDoc(doc);
  }

  private reportMalformed(doc: OpenDoc): void {
    if (doc.csvErrorLine !== null) this.notify('error', S.csvMalformed(doc.csvErrorLine));
  }

  private addDoc(doc: OpenDoc): void {
    doc.onContentChange = () => this.schedulePersist(doc);
    doc.onUiChange = () => this.bump();
    doc.canEditRendered = (d) => {
      if (d.renderedAccepted || storageGet(SKIP_REFORMAT_KEY) === '1') return true;
      // The warning protects existing formatting. A never-saved or empty file has none. Remember
      // this, so that saving a new file can't bring the warning up in the middle of typing.
      if (d.isNew || d.source!.text().trim() === '') d.renderedAccepted = true;
      return d.renderedAccepted;
    };
    doc.requestRenderedEdit = (d) => void this.askReformat(d);
    this.docs = [...this.docs, doc];
    this.activate(doc.id);
  }

  activate(id: string): void {
    this.activeId = id;
    this.bump();
    requestAnimationFrame(() => {
      const doc = this.active;
      doc?.source?.view.requestMeasure();
      doc?.focus();
    });
  }

  cycleTab(step: number): void {
    if (this.docs.length < 2) return;
    const index = this.docs.findIndex((d) => d.id === this.activeId);
    this.activate(this.docs[(index + step + this.docs.length) % this.docs.length].id);
  }

  // ---- Rendered-side warning ----

  private askReformat(doc: OpenDoc): Promise<void> {
    this.reformatPrompt ??= (async () => {
      const result = await this.ask({
        title: S.reformatTitle,
        body: S.reformatBody,
        actions: [
          { id: 'source', label: S.reformatSource },
          { id: 'continue', label: S.reformatContinue, primary: true },
        ],
        cancelId: 'source',
        checkbox: S.dontShowAgain,
      });
      this.reformatPrompt = null;
      if (result.action === 'continue') {
        doc.renderedAccepted = true;
        if (result.checked) storageSet(SKIP_REFORMAT_KEY, '1');
        requestAnimationFrame(() => doc.rendered?.focus());
      } else {
        if (doc.viewMode === 'rendered') doc.setViewMode('split');
        requestAnimationFrame(() => doc.source?.focus());
      }
    })();
    return this.reformatPrompt;
  }

  // ---- Saving ----

  /** Encode an edited file, asking first if its encoding can't hold the text. */
  private async prepareBytes(
    text: string,
    encoding: EncodingName,
    hasBom: boolean,
  ): Promise<{ bytes: Uint8Array; encoding: EncodingName; hasBom: boolean } | null> {
    const bad = findUnencodable(text, encoding);
    if (bad) {
      const { action } = await this.ask({
        title: S.unencodableTitle,
        body: S.unencodableBody(bad.char, ENCODING_LABELS[encoding]),
        actions: [
          { id: 'cancel', label: S.cancel },
          { id: 'utf8', label: S.saveAsUtf8, primary: true },
        ],
        cancelId: 'cancel',
      });
      if (action !== 'utf8') return null;
      if (findUnencodable(text, 'utf-8')) return null;
      return { bytes: encodeText(text, 'utf-8', false), encoding: 'utf-8', hasBom: false };
    }
    return { bytes: encodeText(text, encoding, hasBom), encoding, hasBom };
  }

  async save(doc: OpenDoc, options: { as?: boolean } = {}): Promise<boolean> {
    doc.flushEditors();
    const dirty = doc.isDirty();
    const fileApi = host().canOverwrite;
    if (!options.as && !dirty && fileApi && !doc.isNew) {
      this.notify('info', S.noChanges);
      return true;
    }

    const text = doc.currentText();
    let prepared: { bytes: Uint8Array; encoding: EncodingName; hasBom: boolean } | null;
    if (dirty) {
      prepared = await this.prepareBytes(text, doc.encoding, doc.hasBom);
      if (!prepared) return false;
    } else {
      // Unedited: exactly the bytes that were read.
      prepared = { bytes: new Uint8Array(doc.originalBytes), encoding: doc.encoding, hasBom: doc.hasBom };
    }

    if (!fileApi) return this.saveByDownload(doc, text, prepared, options.as === true);
    if (options.as || !doc.binding) return this.saveAsPicker(doc, text, prepared);
    return this.saveToBinding(doc, text, prepared);
  }

  private async saveByDownload(
    doc: OpenDoc,
    text: string,
    prepared: { bytes: Uint8Array; encoding: EncodingName; hasBom: boolean },
    askName: boolean,
  ): Promise<boolean> {
    let name = doc.name;
    if (askName) {
      const result = await this.ask({
        title: S.downloadAs,
        body: '',
        input: { label: S.fileNameLabel, value: doc.name },
        actions: [
          { id: 'cancel', label: S.cancel },
          { id: 'download', label: S.download, primary: true },
        ],
        cancelId: 'cancel',
      });
      if (result.action !== 'download' || !result.value.trim()) return false;
      name = result.value.trim();
    }
    await host().exportCopy(name, prepared.bytes);
    doc.markSaved({ ...prepared, text, name });
    this.notify('info', S.downloaded(name));
    return true;
  }

  private async saveAsPicker(
    doc: OpenDoc,
    text: string,
    prepared: { bytes: Uint8Array; encoding: EncodingName; hasBom: boolean },
  ): Promise<boolean> {
    try {
      const target = await host().pickSaveTarget(doc.name);
      if (!target) return false;
      const { modifiedMs } = await host().write(target.binding, prepared.bytes);
      doc.markSaved({ ...prepared, text, binding: target.binding, name: target.name, fileLastModified: modifiedMs });
      this.notify('info', S.saved(target.name));
      return true;
    } catch (error) {
      return this.saveFailed(doc, text, prepared, error);
    }
  }

  private async saveToBinding(
    doc: OpenDoc,
    text: string,
    prepared: { bytes: Uint8Array; encoding: EncodingName; hasBom: boolean },
  ): Promise<boolean> {
    const binding = doc.binding!;
    try {
      let permission = await host().ensureWritable(binding);
      if (permission === 'prompt') {
        const { action } = await this.ask({
          title: S.permissionTitle(doc.name),
          body: S.permissionBody,
          actions: [
            { id: 'cancel', label: S.cancel },
            { id: 'continue', label: S.permissionContinue, primary: true },
          ],
          cancelId: 'cancel',
        });
        if (action !== 'continue') return false;
        permission = await host().ensureWritable(binding);
      }
      if (permission !== 'granted') throw new DOMException('Permission denied', 'NotAllowedError');
      const onDisk = await host().stat(binding);
      if (onDisk.size !== doc.fileSize || onDisk.modifiedMs !== doc.fileLastModified) {
        const { action } = await this.ask({
          title: S.conflictTitle,
          body: S.conflictBody(doc.name),
          actions: [
            { id: 'cancel', label: S.cancel },
            { id: 'saveas', label: S.saveAs },
            { id: 'overwrite', label: S.overwrite, danger: true },
          ],
          cancelId: 'cancel',
        });
        if (action === 'cancel') return false;
        if (action === 'saveas') return this.saveAsPicker(doc, text, prepared);
      }
      const { modifiedMs } = await host().write(binding, prepared.bytes);
      doc.markSaved({ ...prepared, text, fileLastModified: modifiedMs });
      this.notify('info', S.saved(doc.name));
      return true;
    } catch (error) {
      return this.saveFailed(doc, text, prepared, error);
    }
  }

  /** The file stays unsaved and its recovery data stays, with a way to get the content out. */
  private async saveFailed(
    doc: OpenDoc,
    text: string,
    prepared: { bytes: Uint8Array; encoding: EncodingName; hasBom: boolean },
    error: unknown,
  ): Promise<boolean> {
    console.error(error);
    const reason = error instanceof Error ? error.message : String(error);
    const { action } = await this.ask({
      title: S.saveFailedTitle,
      body: S.saveFailedBody(doc.name, reason),
      actions: [
        { id: 'cancel', label: S.cancel },
        { id: 'saveas', label: S.saveAs, primary: !host().canDownload },
        ...(host().canDownload ? [{ id: 'download', label: S.download, primary: true }] : []),
      ],
      cancelId: 'cancel',
    });
    if (action === 'saveas') return this.saveAsPicker(doc, text, prepared);
    if (action === 'download') await host().exportCopy(doc.name, prepared.bytes);
    return false;
  }

  // ---- Closing ----

  /** Resolves to false if the file stayed open, because of Cancel or a save that didn't happen. */
  async closeDoc(doc: OpenDoc): Promise<boolean> {
    doc.flushEditors();
    if (doc.isDirty()) {
      const { action } = await this.ask({
        title: S.closeTitle(doc.name),
        body: S.closeBody,
        actions: [
          { id: 'cancel', label: S.cancel },
          { id: 'discard', label: S.dontSave },
          { id: 'save', label: host().canOverwrite ? S.save : S.download, primary: true },
        ],
        cancelId: 'cancel',
      });
      if (action === 'cancel') return false;
      if (action === 'save' && !(await this.save(doc))) return false;
    }
    const timer = this.persistTimers.get(doc);
    if (timer !== undefined) window.clearTimeout(timer);
    this.persistTimers.delete(doc);

    const index = this.docs.indexOf(doc);
    this.docs = this.docs.filter((d) => d !== doc);
    if (this.activeId === doc.id) {
      this.activeId = this.docs[Math.min(index, this.docs.length - 1)]?.id ?? null;
    }
    doc.destroy();
    this.bump();
    await doc.persistChain;
    await deleteRecord(doc.id);
    this.broadcast();
    requestAnimationFrame(() => this.active?.focus());
    return true;
  }

  /** For quitting: asks about each unsaved file in turn, and stops at the first that stays open. */
  async closeAll(): Promise<boolean> {
    for (const doc of this.docs.slice()) {
      if (doc.isDirty()) this.activate(doc.id);
      if (!(await this.closeDoc(doc))) return false;
    }
    return true;
  }

  // ---- Persistence ----

  private async writeRecord(record: DocumentRecord): Promise<void> {
    try {
      await putRecord(record);
      if (this.storageProblem) {
        this.storageProblem = false;
        this.bump();
      }
    } catch (error) {
      console.error(error);
      this.storageProblem = true;
      this.bump();
    }
  }

  private schedulePersist(doc: OpenDoc): void {
    const existing = this.persistTimers.get(doc);
    if (existing !== undefined) window.clearTimeout(existing);
    this.persistTimers.set(
      doc,
      window.setTimeout(() => this.persistNow(doc), PERSIST_DEBOUNCE_MS),
    );
  }

  private persistNow(doc: OpenDoc): void {
    this.persistTimers.delete(doc);
    if (doc.closed) return;
    // A new file nobody has typed in yet has nothing worth recovering.
    if (doc.isNew && !doc.isDirty()) {
      doc.persistChain = doc.persistChain.then(() => deleteRecord(doc.id)).catch(() => undefined);
      return;
    }
    const record = doc.toRecord(sessionId);
    doc.persistChain = doc.persistChain.then(() => this.writeRecord(record));
  }

  /** Resolves once everything typed so far is in the recovery store. */
  flushPersistence(): Promise<void> {
    for (const doc of this.docs) doc.rendered?.flushEdit();
    for (const doc of Array.from(this.persistTimers.keys())) {
      window.clearTimeout(this.persistTimers.get(doc));
      this.persistNow(doc);
    }
    return Promise.all(this.docs.map((doc) => doc.persistChain)).then(() => undefined);
  }

  // ---- Recovery ----

  private broadcast(): void {
    this.channel?.postMessage('changed');
  }

  async refreshRecovery(): Promise<void> {
    const live = await liveSessions();
    const records = await allRecords();
    for (const record of records) {
      if (record.sessionId === sessionId || !live.has(record.sessionId) || this.watched.has(record.sessionId)) continue;
      this.watched.add(record.sessionId);
      watchSession(record.sessionId, () => {
        window.setTimeout(() => void this.refreshRecovery(), 50);
        window.setTimeout(() => void this.refreshRecovery(), 500);
      });
    }
    let abandoned = records.filter((r) => !live.has(r.sessionId));
    const evicted = selectEvictions(abandoned, MAX_RECOVERY_ENTRIES);
    if (evicted.length > 0) {
      await deleteAbandoned(live, new Set(evicted.map((r) => r.id)));
      const gone = new Set(evicted.map((r) => r.id));
      abandoned = abandoned.filter((r) => !gone.has(r.id));
    }
    this.recovery = abandoned
      .map(({ originalBytes: _b, currentText, lastSavedText: _l, handle: _h, nativePath: _p, ...entry }) => ({
        ...entry,
        fileSize: new Blob([currentText]).size,
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
    this.bump();
  }

  private async findRecord(id: string): Promise<DocumentRecord | undefined> {
    return (await allRecords()).find((r) => r.id === id);
  }

  async restore(id: string): Promise<void> {
    const live = await liveSessions();
    const entry = this.recovery.find((r) => r.id === id);
    const record = await claimRecord(id, sessionId, live);
    if (!record) {
      this.notify('error', S.restoreFailed(entry?.name ?? ''));
      await this.refreshRecovery();
      return;
    }
    const doc = await OpenDoc.create({
      id: record.id,
      name: record.name,
      kind: record.kind,
      binding: bindingFromStored(record),
      originalBytes: record.originalBytes,
      encoding: record.encoding as EncodingName,
      hasBom: record.hasBom,
      lossy: false,
      fileSize: record.fileSize,
      fileLastModified: record.fileLastModified,
      lastSavedText: record.lastSavedText,
      currentText: record.currentText,
      delimiter: record.delimiter,
    });
    this.addDoc(doc);
    this.reportMalformed(doc);
    await this.refreshRecovery();
    this.broadcast();
    if (this.recovery.length === 0) this.recoveryDialogOpen = false;
    this.bump();
  }

  async restoreAll(): Promise<void> {
    for (const entry of this.recovery.slice()) await this.restore(entry.id);
  }

  async downloadCopy(id: string): Promise<void> {
    const record = await this.findRecord(id);
    if (!record) return;
    let bytes: Uint8Array;
    if (record.hasUnsavedChanges) {
      const prepared = await this.prepareBytes(record.currentText, record.encoding as EncodingName, record.hasBom);
      if (!prepared) return;
      bytes = prepared.bytes;
    } else {
      bytes = new Uint8Array(record.originalBytes);
    }
    try {
      await host().exportCopy(record.name, bytes);
    } catch (error) {
      console.error(error);
      this.notify('error', S.saveFailedTitle);
    }
  }

  async discard(id: string): Promise<void> {
    const entry = this.recovery.find((r) => r.id === id);
    if (entry?.hasUnsavedChanges) {
      const { action } = await this.ask({
        title: S.discardTitle(entry.name),
        body: S.discardBody,
        actions: [
          { id: 'cancel', label: S.cancel },
          { id: 'discard', label: S.discard, danger: true },
        ],
        cancelId: 'cancel',
      });
      if (action !== 'discard') return;
    }
    await deleteAbandoned(await liveSessions(), new Set([id]));
    await this.refreshRecovery();
    this.broadcast();
  }

  async clearAllRecovery(): Promise<void> {
    const { action } = await this.ask({
      title: S.clearAllTitle,
      body: S.clearAllBody,
      actions: [
        { id: 'cancel', label: S.cancel },
        { id: 'clear', label: S.clearAll, danger: true },
      ],
      cancelId: 'cancel',
    });
    if (action !== 'clear') return;
    await deleteAbandoned(await liveSessions());
    await this.refreshRecovery();
    this.broadcast();
    this.recoveryDialogOpen = false;
    this.bump();
  }

  // ---- Reopen, revert, copy ----

  async reopenWith(doc: OpenDoc, encoding: EncodingName): Promise<void> {
    if (doc.isDirty()) {
      const { action } = await this.ask({
        title: S.reopenTitle,
        body: S.reopenBody(ENCODING_LABELS[encoding]),
        actions: [
          { id: 'cancel', label: S.cancel },
          { id: 'reopen', label: S.reopenAction, danger: true },
        ],
        cancelId: 'cancel',
      });
      if (action !== 'reopen') return;
    }
    await doc.reopenAs(encoding);
  }

  async revert(doc: OpenDoc): Promise<void> {
    const { action } = await this.ask({
      title: S.revertTitle,
      body: S.revertBody,
      actions: [
        { id: 'cancel', label: S.cancel },
        { id: 'revert', label: S.revertAction, danger: true },
      ],
      cancelId: 'cancel',
    });
    if (action === 'revert') doc.revert();
  }

  async copy(html: string | null, plain: string): Promise<void> {
    try {
      await writeClipboard(html, plain);
      this.notify('info', S.copied);
    } catch (error) {
      console.error(error);
      this.notify('error', S.copyFailed);
    }
  }

  async copySource(doc: OpenDoc): Promise<void> {
    doc.flushEditors();
    await this.copy(null, doc.currentText());
  }

  async copyRendered(doc: OpenDoc): Promise<void> {
    const dom = doc.rendered?.dom;
    if (!dom) return;
    await this.copy(dom.innerHTML, dom.innerText);
  }

  async copyValues(values: string[][]): Promise<void> {
    await this.copy(toHtmlTable(values), toTsv(values));
  }
}

export const ws = new Workspace();
