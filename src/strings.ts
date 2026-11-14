import { ca } from './strings.ca';

/** All interface text. Other languages are typed against this one, in strings.<language>.ts. */
const en = {
  openFile: 'Open file',
  openFiles: 'Open files',
  openOrCreate: 'Open or create a file',
  newFile: 'New file',
  newMarkdown: 'New Markdown file',
  newCsv: 'New CSV file',
  newText: 'New text file',
  dropHint: 'or drop a CSV, Markdown or text file',
  dropOverlay: 'Drop to open',
  privacyHint: 'Files never leave this device',
  nameMeaning: ['Catalan for ', 'sheet'],
  menu: 'Commands',
  closeTab: (name: string) => `Close ${name}`,
  unsaved: 'unsaved changes',
  dismiss: 'Dismiss',
  commandPlaceholder: 'Type a command',
  noCommands: 'No matching commands',
  menuTitle: (keys: string) => `Commands (${keys})`,
  commandsHint: (keys: string) => `${keys} for commands`,
  pickerDescription: 'CSV, Markdown and text files',

  save: 'Save',
  download: 'Download',
  saveAs: 'Save As',
  downloadAs: 'Download As',
  undo: 'Undo',
  redo: 'Redo',
  revert: 'Revert to last saved',
  exportHtml: 'Export as HTML…',
  exportPdf: 'Print or save as PDF…',
  exportXlsx: 'Export as Excel (.xlsx)…',
  closeFile: 'Close file',
  nextTab: 'Next tab',
  previousTab: 'Previous tab',
  copySource: 'Copy source',
  copyRendered: 'Copy rendered',
  copyFileText: 'Copy text',
  copySelection: 'Copy selection',
  copyTable: 'Copy whole table',
  cut: 'Cut selection',
  paste: 'Paste',
  viewSplit: 'View: side by side',
  viewSource: 'View: source only',
  viewRendered: 'View: rendered only',
  viewGrid: 'View: table',
  viewRaw: 'View: raw CSV text',
  toggleHeader: 'Toggle first row as header',
  toggleWrap: 'Toggle word wrap',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  zoomReset: 'Zoom: actual size',
  loadRemoteImages: 'Load remote images in this file',
  blockRemoteImages: 'Block remote images in this file',
  insertRowAbove: 'Insert row above',
  insertRowBelow: 'Insert row below',
  deleteRows: 'Delete selected rows',
  insertColumnLeft: 'Insert column left',
  insertColumnRight: 'Insert column right',
  deleteColumns: 'Delete selected columns',
  moveRowsUp: 'Move selected rows up',
  moveRowsDown: 'Move selected rows down',
  moveColumnsLeft: 'Move selected columns left',
  moveColumnsRight: 'Move selected columns right',
  fitRows: 'Fit selected rows to content',
  fitColumns: 'Fit selected columns to content',
  insertRowsAbove: (n: number) => (n > 1 ? `Insert ${n} rows above` : 'Insert row above'),
  insertRowsBelow: (n: number) => (n > 1 ? `Insert ${n} rows below` : 'Insert row below'),
  insertColumnsLeft: (n: number) => (n > 1 ? `Insert ${n} columns left` : 'Insert column left'),
  insertColumnsRight: (n: number) => (n > 1 ? `Insert ${n} columns right` : 'Insert column right'),
  fitRowCount: (n: number) => (n > 1 ? `Fit ${n} rows to content` : 'Fit row to content'),
  fitColumnCount: (n: number) => (n > 1 ? `Fit ${n} columns to content` : 'Fit column to content'),
  rowHeight: 'Row height',
  columnWidth: 'Column width',
  deleteRowCount: (n: number) => (n > 1 ? `Delete ${n} rows` : 'Delete row'),
  deleteColumnCount: (n: number) => (n > 1 ? `Delete ${n} columns` : 'Delete column'),
  selectAll: 'Select whole table',
  switchToDark: 'Switch to dark theme',
  switchToLight: 'Switch to light theme',
  accentNames: { blue: 'blue', green: 'green', orange: 'orange', coral: 'coral', violet: 'violet' } as Record<string, string>,
  accentCommand: (name: string) => `Accent: ${name}`,
  changeAccent: 'Change accent colour',
  themeSystem: 'Theme: follow system',
  themeDark: 'Theme: dark',
  themeLight: 'Theme: light',
  languageCommand: (name: string) => `Language: ${name}`,
  changeLanguage: (code: string) => `Change language (${code})`,
  languageQuery: 'Language:',
  reopenWith: (label: string) => `Reopen with encoding: ${label}`,
  delimiterCommand: (label: string) => `CSV delimiter: ${label}`,
  recoverFiles: 'Show recoverable files',
  encodingQuery: 'Reopen',
  delimiterQuery: 'delimiter',
  accentQuery: 'Accent',

  delimiterNames: { ',': 'comma', ';': 'semicolon', '\t': 'tab', '|': 'pipe' } as Record<string, string>,
  lineEndingNames: { lf: 'LF', crlf: 'CRLF', cr: 'CR', mixed: 'Mixed' } as Record<string, string>,
  kindNames: { csv: 'CSV', markdown: 'Markdown', text: 'Text' } as Record<string, string>,
  mixedNotice: 'Mixed line endings: the first saved edit may convert them all',
  lossyNotice: 'Contains invalid characters for this encoding',
  rowsColumns: (rows: number, columns: number) =>
    `${rows.toLocaleString('en')} ${rows === 1 ? 'row' : 'rows'} × ${columns.toLocaleString('en')} ${columns === 1 ? 'column' : 'columns'}`,
  buildUnknown: 'Build unknown',
  buildLabel: (short: string) => `Build ${short}`,
  previewLabel: (short: string) => `Preview · ${short}`,
  buildTitle: (release: string | null, sha: string, environment: string) =>
    `${release ? `Latest release: ${release}\n` : ''}Deployed commit: ${sha}\nEnvironment: ${environment}`,

  unsupported: (name: string) => `"${name}" can't be opened. Supported types: CSV, Markdown and TXT.`,
  notText: (name: string) => `"${name}" can't be opened because it isn't a text file.`,
  readFailed: (name: string) => `"${name}" couldn't be read.`,
  largeFile: (name: string) => `"${name}" is over 50 MB and may be slow, or may not fit in this browser's memory.`,
  noChanges: 'No changes to save',
  saved: (name: string) => `Saved ${name}`,
  downloaded: (name: string) => `Downloaded ${name}`,
  exported: (name: string) => `Exported ${name}`,
  exportFailed: (reason: string) => `Couldn't export the file. The open file hasn't changed. (${reason})`,
  xlsxTooManyRows: "This table has more than 1,048,576 rows, which Excel can't open, so it wasn't exported.",
  xlsxTooManyColumns: "This table has more than 16,384 columns, which Excel can't open, so it wasn't exported.",
  xlsxCellTooLong: (cell: string) =>
    `Cell ${cell} holds more than 32,767 characters, which Excel can't open, so the table wasn't exported.`,
  copied: 'Copied',
  copyFailed: "Couldn't write to the clipboard",
  pasteFailed: "Couldn't read the clipboard. Use your browser's paste shortcut instead.",
  storageWarning: "Recovery isn't protecting your open files right now because this browser refused to store them.",
  browserLimit:
    "This browser can't overwrite files on disk, so saving downloads a new copy. Use Chrome or Edge to save over the original.",
  csvMalformed: (line: number) =>
    `Malformed CSV near line ${line}, so it's shown as raw text. The file hasn't been changed.`,
  csvStillMalformed: (line: number) => `The CSV is still malformed near line ${line}. Fix it to return to the table.`,
  delimiterFailed: (label: string) => `This file can't be read with ${label} as the delimiter.`,
  restoreFailed: (name: string) => `"${name}" can't be restored because another tab has already taken it.`,
  remoteBlocked: 'Remote images are blocked.',

  imageBlocked: (src: string) => `Remote image blocked: ${src}`,
  imageRelative: (src: string) => `Image not available: ${src}`,
  imageUnsafe: (src: string) => `Image not shown: ${src}`,

  cancel: 'Cancel',
  reformatTitle: 'Edit the rendered side?',
  reformatBody:
    "Editing here may reformat parts of this file's Markdown, including parts you don't change. Editing the source side doesn't do this.",
  reformatContinue: 'Continue',
  reformatSource: 'Edit source instead',
  dontShowAgain: "Don't show this again",
  noExtensionTitle: (name: string) => `Save "${name}" without an extension?`,
  noExtensionBody: 'Other apps may not recognise its type.',
  saveWithoutExtension: 'Save without extension',
  closeTitle: (name: string) => `Save changes to "${name}"?`,
  closeBody: 'Your changes will be lost if you don\'t save them.',
  closeMissingTitle: (name: string) => `Save "${name}" again?`,
  closeMissingBody: "The file is no longer on disk, so its contents will be lost if you don't save it.",
  dontSave: "Don't save",
  revertTitle: 'Revert to last saved?',
  revertBody: 'This replaces the current text with the last saved version. You can undo this.',
  revertAction: 'Revert',
  reopenTitle: 'Reopen and lose changes?',
  reopenBody: (label: string) => `Reopening as ${label} discards your unsaved changes to this file.`,
  reopenAction: 'Reopen',
  unencodableTitle: "This file's encoding can't store a character",
  unencodableBody: (char: string, encoding: string) =>
    `${encoding} can't represent "${char}". Nothing has been saved.`,
  saveAsUtf8: 'Save as UTF-8',
  conflictTitle: 'The file changed on disk',
  conflictBody: (name: string) => `"${name}" was changed outside this app since it was last read or saved.`,
  overwrite: 'Overwrite',
  reload: 'Reload',
  reloadTitle: (name: string) => `Reload "${name}" from disk?`,
  reloadBody: 'Your unsaved changes to this file will be lost.',
  permissionTitle: (name: string) => `Continue saving "${name}"?`,
  permissionBody: 'Your browser needs one more confirmation before this file can be overwritten.',
  permissionContinue: 'Continue',
  saveFailedTitle: "Couldn't save the file",
  saveFailedBody: (name: string, reason: string) =>
    `"${name}" wasn't saved and is still marked as unsaved. Recovery data has been kept. (${reason})`,
  fileNameLabel: 'File name',

  recoveryHeading: 'Recover files',
  recoveryBanner: (count: number) =>
    `${count} ${count === 1 ? 'file' : 'files'} from an earlier session can be recovered.`,
  recoveryReview: 'Review',
  recoveryNote: 'These stay here until you restore or discard them, so you can open or create other files first.',
  recoveryEmpty: 'Nothing to recover.',
  restore: 'Restore',
  downloadCopy: 'Download copy',
  saveCopy: 'Save a copy',
  discard: 'Discard',
  restoreAll: 'Restore all',
  clearAll: 'Clear all recovery data',
  close: 'Close',
  hasUnsaved: 'unsaved changes',
  noUnsaved: 'no unsaved changes',
  discardTitle: (name: string) => `Discard unsaved changes to "${name}"?`,
  discardBody: "They can't be recovered afterwards.",
  clearAllTitle: 'Clear all recovery data?',
  clearAllBody:
    'This permanently removes every recoverable file from this browser. Files currently open in a tab are not affected.',
  edited: (when: string) => `edited ${when}`,

  renderFailed: "This Markdown couldn't be rendered. The source is unaffected.",
  frontMatterLabel: 'Front matter',
  grid: 'CSV table',
  missingCell: 'missing cell',
  source: 'Source',
  rendered: 'Rendered Markdown',
  /** Over a link, while a plain click there places the caret. `key` is ⌘ or Ctrl. */
  linkOpenHint: (key: string) => `${key}-click to open the link`,
  htmlPreview: 'Preview',
  formatBar: 'Formatting',
  showFormatBar: 'Show formatting bar',
  hideFormatBar: 'Hide formatting bar',
  formatNames: {
    bold: 'Bold',
    italic: 'Italic',
    code: 'Inline code',
    codeBlock: 'Code block',
    heading: 'Heading',
    bullets: 'Bulleted list',
    numbers: 'Numbered list',
    quote: 'Quote',
    link: 'Link',
  } as Record<string, string>,
  formatCommand: (name: string) => `Format: ${name.toLowerCase()}`,
  linkTitle: 'Add a link',
  linkAddress: 'Address',
  addLink: 'Add link',
  previewPaused: 'This file is too large for the preview to follow typing, so it shows the file as it was when opened or last saved.',
  resizeSplit: 'Resize panes',

  numberLocale: 'en',
  /** English keeps the browser's own date format, such as day-first for en-GB. */
  dateLocale: undefined as string | undefined,
  /** Text inside the source editor's search panel, keyed by CodeMirror's English. */
  editorPhrases: {
    Find: 'Find',
    Replace: 'Replace with',
    next: 'Next',
    previous: 'Previous',
    all: 'All',
    'match case': 'Match case',
    regexp: 'Regular expression',
    'by word': 'Whole word',
    replace: 'Replace',
    'replace all': 'Replace all',
    close: 'Close',
  } as Record<string, string>,
};

export type Strings = typeof en;

/** Each language's name in that language, so it can be found from any other one. */
export const LANGUAGES = { en: 'English', ca: 'Català' } as const;
export type Language = keyof typeof LANGUAGES;
export const LANGUAGE_CODES = Object.keys(LANGUAGES) as Language[];
export const LANGUAGE_KEY = 'full.language';

const STRINGS: Record<Language, Strings> = { en, ca };

const isLanguage = (code: string | null): code is Language => code === 'en' || code === 'ca';

/** A stored choice wins; otherwise the first browser language the app has, then English. */
export function pickLanguage(stored: string | null, preferred: readonly string[]): Language {
  if (isLanguage(stored)) return stored;
  for (const tag of preferred) {
    const code = tag.split('-')[0].toLowerCase();
    if (isLanguage(code)) return code;
  }
  return 'en';
}

export const browserLanguage = (): Language => pickLanguage(null, navigator.languages ?? []);

function storedLanguage(): string | null {
  try {
    return localStorage.getItem(LANGUAGE_KEY);
  } catch {
    return null;
  }
}

/** Live bindings: read these when they're needed, and never keep a copy of a string. */
export let language: Language = pickLanguage(storedLanguage(), typeof navigator === 'undefined' ? [] : (navigator.languages ?? []));
export let S: Strings = STRINGS[language];

/** For another kind of build, such as the desktop app, before the interface first renders. */
export function overrideStrings(overrides: Record<Language, Partial<Strings>>): void {
  for (const code of LANGUAGE_CODES) Object.assign(STRINGS[code], overrides[code]);
}

export function setLanguage(next: Language): void {
  language = next;
  S = STRINGS[next];
}
