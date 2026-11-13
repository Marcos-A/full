import { isolateHistory } from '@codemirror/commands';
import { EditorSelection, EditorState, Line, SelectionRange, TransactionSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

/**
 * Basic Markdown formatting for the source side. Each action is one small transaction, so undo
 * takes it back in one step and everything outside the change stays byte for byte. Each one
 * toggles, and follows the markers the file already uses, found by reading only nearby lines.
 */

export type FormatAction = 'bold' | 'italic' | 'code' | 'codeBlock' | 'heading' | 'bullets' | 'numbers' | 'quote' | 'link';

export const FORMAT_ACTIONS: FormatAction[] = ['bold', 'italic', 'code', 'codeBlock', 'heading', 'bullets', 'numbers', 'quote', 'link'];

/**
 * Matched by key position, as Option and Shift change the character: Shift+7 is "/" on a Spanish
 * keyboard. Cmd/Ctrl+K is the palette, so the link uses Alt+K.
 */
const KEYS: Record<FormatAction, { code: string; shift?: boolean; alt?: boolean }> = {
  bold: { code: 'KeyB' },
  italic: { code: 'KeyI' },
  code: { code: 'KeyE' },
  codeBlock: { code: 'KeyE', shift: true },
  heading: { code: 'KeyH', alt: true },
  numbers: { code: 'Digit7', shift: true },
  bullets: { code: 'Digit8', shift: true },
  quote: { code: 'Digit9', shift: true },
  link: { code: 'KeyK', alt: true },
};

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

export function formatActionForKey(event: KeyboardEvent): FormatAction | undefined {
  const primary = isMac ? event.metaKey : event.ctrlKey;
  const secondary = isMac ? event.ctrlKey : event.metaKey;
  if (!primary || secondary) return undefined;
  return FORMAT_ACTIONS.find((action) => {
    const key = KEYS[action];
    return key.code === event.code && Boolean(key.shift) === event.shiftKey && Boolean(key.alt) === event.altKey;
  });
}

export function formatShortcut(action: FormatAction): string {
  const key = KEYS[action];
  const name = key.code.replace(/^Key|^Digit/, '');
  if (isMac) return `${key.alt ? '⌥' : ''}${key.shift ? '⇧' : ''}⌘${name}`;
  return `Ctrl+${key.alt ? 'Alt+' : ''}${key.shift ? 'Shift+' : ''}${name}`;
}

// ---- Markers the file already uses ----

/** How far to look for the file's habits. Never the whole document. */
const NEARBY_LINES = 200;

function nearbyText(state: EditorState, pos: number): string {
  const doc = state.doc;
  const line = doc.lineAt(pos).number;
  const from = doc.line(Math.max(1, line - NEARBY_LINES)).from;
  const to = doc.line(Math.min(doc.lines, line + NEARBY_LINES)).to;
  return doc.sliceString(from, to);
}

function preferred(state: EditorState, pos: number, action: 'bold' | 'italic' | 'bullets' | 'fence' | 'numbers'): string {
  const text = nearbyText(state, pos);
  switch (action) {
    case 'bold':
      return /(^|[^\w_])__\S[^\n]*?\S?__(?![\w_])/.test(text) && !/\*\*\S/.test(text) ? '__' : '**';
    case 'italic': {
      const underscore = /(^|[^\w_])_[^\s_][^\n_]*_(?![\w_])/.test(text);
      const star = /(^|[^*\w])\*[^\s*][^\n*]*\*(?!\*)/.test(text);
      return underscore && !star ? '_' : '*';
    }
    case 'bullets':
      return /^[ \t]*\* \S/m.test(text) && !/^[ \t]*- \S/m.test(text) ? '*' : /^[ \t]*\+ \S/m.test(text) && !/^[ \t]*[-*] \S/m.test(text) ? '+' : '-';
    case 'numbers':
      return /^[ \t]*\d+\) /m.test(text) && !/^[ \t]*\d+\. /m.test(text) ? ')' : '.';
    case 'fence':
      return /^[ \t]*~~~/m.test(text) && !/^[ \t]*```/m.test(text) ? '~~~' : '```';
  }
}

// ---- Inline: bold, italic, code ----

/** The run of `char` touching `pos`, looking left (-1) or right (1). */
function runLength(state: EditorState, pos: number, char: string, direction: -1 | 1): number {
  let count = 0;
  const limit = direction < 0 ? Math.max(0, pos - 3) : Math.min(state.doc.length, pos + 3);
  const text = direction < 0 ? state.doc.sliceString(limit, pos) : state.doc.sliceString(pos, limit);
  const chars = direction < 0 ? text.split('').reverse() : text.split('');
  for (const c of chars) {
    if (c !== char) break;
    count++;
  }
  return count;
}

/** `*` is italic in a run of 1 or 3, and `**` is bold in a run of 2 or 3. */
const fits = (run: number, size: number, char: string) =>
  char === '`' ? run === size : size === 1 ? run === 1 || run === 3 : run >= 2;

function toggleInline(state: EditorState, marker: string): TransactionSpec {
  const char = marker[0];
  const size = marker.length;
  return state.changeByRange((range) => {
    // Spaces just inside a selection can't go inside the markers, so they stay outside.
    let from = range.from;
    let to = range.to;
    if (!range.empty) {
      const text = state.sliceDoc(from, to);
      from += text.length - text.trimStart().length;
      to -= text.length - text.trimEnd().length;
      if (from >= to) {
        from = range.from;
        to = range.to;
      }
    }
    const before = runLength(state, from, char, -1);
    const after = runLength(state, to, char, 1);
    if (fits(before, size, char) && fits(after, size, char)) {
      return {
        changes: [
          { from: from - size, to: from },
          { from: to, to: to + size },
        ],
        range: EditorSelection.range(from - size, to - size),
      };
    }
    const inner = state.sliceDoc(from, to);
    if (inner.length > size * 2 && inner.startsWith(marker) && inner.endsWith(marker)) {
      const innerBefore = runLength(state, from + size, char, -1);
      if (fits(innerBefore, size, char) || char === '`') {
        return {
          changes: [
            { from, to: from + size },
            { from: to - size, to },
          ],
          range: EditorSelection.range(from, to - size * 2),
        };
      }
    }
    if (from === to) {
      return { changes: { from, insert: marker + marker }, range: EditorSelection.cursor(from + size) };
    }
    return {
      changes: [
        { from, insert: marker },
        { from: to, insert: marker },
      ],
      range: EditorSelection.range(from + size, to + size),
    };
  });
}

// ---- Lines: bullets, numbers, quote, heading ----

/** The lines the selection covers, each once, in order. */
function selectedLines(state: EditorState): Line[] {
  const seen = new Set<number>();
  const lines: Line[] = [];
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number;
    let last = state.doc.lineAt(range.to).number;
    // A selection ending at the start of a line doesn't take that line.
    if (last > first && state.doc.line(last).from === range.to) last--;
    for (let n = first; n <= last; n++) {
      if (seen.has(n)) continue;
      seen.add(n);
      lines.push(state.doc.line(n));
    }
  }
  return lines.sort((a, b) => a.number - b.number);
}

const BULLET = /^([ \t]*)([-*+])( +|$)/;
const NUMBER = /^([ \t]*)(\d{1,9})([.)])( +|$)/;
const QUOTE = /^([ \t]*)> ?/;
const HEADING = /^(#{1,6})( +|$)/;

type LineChange = { from: number; to: number; insert: string };

function applyLines(state: EditorState, edit: (line: Line, index: number) => LineChange | null): TransactionSpec {
  const changes: LineChange[] = [];
  selectedLines(state).forEach((line, index) => {
    const change = edit(line, index);
    if (change) changes.push(change);
  });
  return { changes };
}

function toggleList(state: EditorState, kind: 'bullets' | 'numbers'): TransactionSpec {
  const lines = selectedLines(state).filter((line) => line.text.trim() !== '');
  const own = kind === 'bullets' ? BULLET : NUMBER;
  const removing = lines.length > 0 && lines.every((line) => own.test(line.text));
  const bullet = preferred(state, state.selection.main.head, 'bullets');
  const delimiter = preferred(state, state.selection.main.head, 'numbers');
  let number = 0;
  // A lone empty line starts a list. Blank lines inside a selection stay as they are.
  const single = selectedLines(state).length === 1;
  return applyLines(state, (line) => {
    if (line.text.trim() === '' && !single) return null;
    const existing = BULLET.exec(line.text) ?? NUMBER.exec(line.text);
    const indent = /^[ \t]*/.exec(line.text)![0];
    const markerEnd = existing ? existing[0].length : indent.length;
    if (removing) return { from: line.from + indent.length, to: line.from + markerEnd, insert: '' };
    const insert = kind === 'bullets' ? `${bullet} ` : `${++number}${delimiter} `;
    return { from: line.from + indent.length, to: line.from + markerEnd, insert };
  });
}

function toggleQuote(state: EditorState): TransactionSpec {
  const lines = selectedLines(state);
  const filled = lines.filter((line) => line.text.trim() !== '');
  const removing = filled.length > 0 && lines.every((line) => QUOTE.test(line.text) || line.text.trim() === '');
  return applyLines(state, (line) => {
    if (removing) {
      const match = QUOTE.exec(line.text);
      return match ? { from: line.from + match[1].length, to: line.from + match[0].length, insert: '' } : null;
    }
    // A blank line inside the selection keeps the quote in one piece.
    if (line.text.trim() === '' && lines.length > 1) return { from: line.from, to: line.from, insert: '>' };
    return { from: line.from, to: line.from, insert: '> ' };
  });
}

/** H1, H2, H3 and back to text. Every selected line takes the step the first one takes. */
function cycleHeading(state: EditorState): TransactionSpec {
  const lines = selectedLines(state);
  const first = HEADING.exec(lines[0].text);
  const level = first ? first[1].length : 0;
  const next = level >= 3 ? 0 : level + 1;
  return applyLines(state, (line) => {
    const match = HEADING.exec(line.text);
    const end = match ? match[0].length : 0;
    if (next === 0 && !match) return null;
    if (next > 0 && line.text.trim() === '' && lines.length > 1) return null;
    return { from: line.from, to: line.from + end, insert: next ? `${'#'.repeat(next)} ` : '' };
  });
}

// ---- Code block ----

const FENCE = /^[ \t]*(`{3,}|~{3,})/;

function toggleCodeBlock(state: EditorState): TransactionSpec {
  const lines = selectedLines(state);
  const doc = state.doc;
  const first = lines[0];
  const last = lines[lines.length - 1];
  // The selection runs from fence to fence, or sits just inside a pair of them.
  let open: Line | null = null;
  let close: Line | null = null;
  if (lines.length >= 2 && FENCE.test(first.text) && FENCE.test(last.text)) {
    open = first;
    close = last;
  } else if (first.number > 1 && last.number < doc.lines) {
    const above = doc.line(first.number - 1);
    const below = doc.line(last.number + 1);
    if (FENCE.test(above.text) && /^[ \t]*(`{3,}|~{3,})[ \t]*$/.test(below.text)) {
      open = above;
      close = below;
    }
  }
  if (open && close) {
    return {
      changes: [
        { from: open.from, to: Math.min(doc.length, open.to + 1) },
        { from: Math.max(0, close.from - 1), to: close.to },
      ],
    };
  }
  const fence = preferred(state, state.selection.main.head, 'fence');
  if (lines.length === 1 && first.text.trim() === '') {
    return {
      changes: { from: first.from, to: first.to, insert: `${fence}\n\n${fence}` },
      selection: EditorSelection.cursor(first.from + fence.length + 1),
    };
  }
  return {
    changes: [
      { from: first.from, insert: `${fence}\n` },
      { from: last.to, insert: `\n${fence}` },
    ],
  };
}

// ---- Link ----

const LINK = /^\[([^\]\n]*)\]\(([^)\n]*)\)$/;
const LOOKS_LIKE_URL = /^(https?:\/\/|mailto:|www\.)\S+$/i;

function toggleLink(state: EditorState): TransactionSpec {
  return state.changeByRange((range: SelectionRange) => {
    const text = state.sliceDoc(range.from, range.to);
    const existing = LINK.exec(text);
    if (existing) {
      return {
        changes: { from: range.from, to: range.to, insert: existing[1] },
        range: EditorSelection.range(range.from, range.from + existing[1].length),
      };
    }
    if (range.empty) {
      return { changes: { from: range.from, insert: '[]()' }, range: EditorSelection.cursor(range.from + 1) };
    }
    if (LOOKS_LIKE_URL.test(text)) {
      return { changes: { from: range.from, to: range.to, insert: `[](${text})` }, range: EditorSelection.cursor(range.from + 1) };
    }
    return {
      changes: { from: range.from, to: range.to, insert: `[${text}]()` },
      range: EditorSelection.cursor(range.from + text.length + 3),
    };
  });
}

export function formatSource(view: EditorView, action: FormatAction): void {
  const state = view.state;
  const head = state.selection.main.head;
  let spec: TransactionSpec;
  switch (action) {
    case 'bold':
      spec = toggleInline(state, preferred(state, head, 'bold'));
      break;
    case 'italic':
      spec = toggleInline(state, preferred(state, head, 'italic'));
      break;
    case 'code':
      spec = toggleInline(state, '`');
      break;
    case 'codeBlock':
      spec = toggleCodeBlock(state);
      break;
    case 'heading':
      spec = cycleHeading(state);
      break;
    case 'bullets':
    case 'numbers':
      spec = toggleList(state, action);
      break;
    case 'quote':
      spec = toggleQuote(state);
      break;
    case 'link':
      spec = toggleLink(state);
      break;
  }
  view.dispatch({ ...spec, annotations: isolateHistory.of('full'), userEvent: 'input.format', scrollIntoView: true });
  view.focus();
}
