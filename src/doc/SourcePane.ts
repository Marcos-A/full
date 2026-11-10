import { history, defaultKeymap, indentLess, insertNewlineKeepIndent, insertTab, isolateHistory, redo, redoDepth, undo, undoDepth } from '@codemirror/commands';
import { cssLanguage } from '@codemirror/lang-css';
import { markdown } from '@codemirror/lang-markdown';
import { HighlightStyle, Language, syntaxHighlighting } from '@codemirror/language';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { Annotation, Compartment, EditorState, Extension, Prec } from '@codemirror/state';
import { drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { minimalChange } from '../core/markdownParts';
import { S } from '../strings';
import { canColour } from './syntax';

/** Marks a change that came from the rendered side, so it isn't loaded back into it. */
const fromRendered = Annotation.define<boolean>();

const highlight = HighlightStyle.define([
  { tag: tags.heading, color: 'var(--syn-heading)', fontWeight: '600' },
  { tag: tags.strong, fontWeight: '600' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.link, color: 'var(--syn-link)' },
  { tag: tags.url, color: 'var(--syn-link)' },
  { tag: tags.monospace, color: 'var(--syn-code)' },
  { tag: tags.processingInstruction, color: 'var(--fg-muted)' },
  { tag: tags.quote, color: 'var(--fg-muted)' },
  { tag: tags.contentSeparator, color: 'var(--fg-muted)' },
]);

/** Only for code files, so that Markdown keeps its look. */
const codeHighlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.operatorKeyword, tags.processingInstruction, tags.tagName], color: 'var(--accent)' },
  { tag: [tags.comment, tags.meta], color: 'var(--syn-comment)' },
  { tag: [tags.string, tags.regexp, tags.escape], color: 'var(--syn-string)' },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: 'var(--syn-number)' },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.macroName, tags.attributeName],
    color: 'var(--syn-function)',
  },
  { tag: [tags.typeName, tags.className, tags.namespace], color: 'var(--syn-type)' },
]);

/** In other languages nearly every other word is a property, and colouring them all is noise. */
const cssHighlight = HighlightStyle.define([{ tag: tags.propertyName, color: 'var(--syn-function)' }], { scope: cssLanguage });

/** A grammar would otherwise re-indent new lines, and typing changes only what's typed. */
const enterKeepsIndent = Prec.high(keymap.of([{ key: 'Enter', run: insertNewlineKeepIndent, shift: insertNewlineKeepIndent }]));

// Only the grammar: the languages' full setups would also add things like closing tags as you type.
const codeSyntax = (language: Language | null): Extension =>
  language ? [language.extension, syntaxHighlighting(codeHighlight), syntaxHighlighting(cssHighlight), enterKeepsIndent] : [];

const theme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'var(--bg)', color: 'var(--fg)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', fontSize: '13px', lineHeight: '1.6', overflow: 'auto' },
  '.cm-content': { caretColor: 'var(--accent)', padding: '8px 0' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '1.5px' },
  '.cm-gutters': { backgroundColor: 'var(--bg)', color: 'var(--fg-faint)', border: 'none' },
  '.cm-activeLine': { backgroundColor: 'var(--line-active)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--line-active)', color: 'var(--fg-muted)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--selection)',
  },
  '.cm-selectionMatch': { backgroundColor: 'var(--selection-soft)' },
  '.cm-panels': { backgroundColor: 'var(--bg-raised)', color: 'var(--fg)' },
  '.cm-panels input, .cm-panels button': { fontFamily: 'var(--font-mono)' },
});

export interface SourcePaneOptions {
  text: string;
  markdown: boolean;
  /** The grammar to colour the text with, if it's a code file and not too big to colour. */
  syntax: Language | null;
  wrap: boolean;
  onChange: (fromRendered: boolean) => void;
  onFocus?: () => void;
}

const localized = (): Extension => [
  EditorState.phrases.of(S.editorPhrases),
  EditorView.contentAttributes.of({ 'aria-label': S.source, spellcheck: 'false' }),
];

export class SourcePane {
  readonly view: EditorView;
  private wrapping = new Compartment();
  private language = new Compartment();
  private syntax = new Compartment();
  private syntaxLanguage: Language | null;

  constructor(options: SourcePaneOptions) {
    this.syntaxLanguage = options.syntax && canColour(options.text) ? options.syntax : null;
    const extensions: Extension[] = [
      lineNumbers(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      drawSelection(),
      history(),
      search({ top: true }),
      highlightSelectionMatches(),
      options.markdown ? syntaxHighlighting(highlight) : [],
      this.syntax.of(codeSyntax(this.syntaxLanguage)),
      theme,
      this.wrapping.of(options.wrap ? EditorView.lineWrapping : []),
      // No closing brackets, list continuation or autocomplete: typing changes only what's typed.
      keymap.of([{ key: 'Tab', run: insertTab, shift: indentLess }, ...searchKeymap, ...defaultKeymap]),
      this.language.of(localized()),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) return;
        options.onChange(update.transactions.some((t) => t.annotation(fromRendered)));
      }),
      EditorView.domEventHandlers({
        focus: () => {
          options.onFocus?.();
          return false;
        },
      }),
    ];
    if (options.markdown) extensions.push(markdown({ addKeymap: false }));
    this.view = new EditorView({ state: EditorState.create({ doc: options.text, extensions }) });
  }

  text(): string {
    return this.view.state.doc.toString();
  }

  get length(): number {
    return this.view.state.doc.length;
  }

  /** One undoable step. Only the part that differs is replaced. */
  applyText(next: string, opts: { fromRendered?: boolean } = {}): void {
    const change = minimalChange(this.text(), next);
    if (!change) return;
    this.view.dispatch({
      changes: change,
      annotations: [isolateHistory.of('full'), fromRendered.of(opts.fromRendered === true)],
    });
  }

  undo(): boolean {
    return undo(this.view);
  }
  redo(): boolean {
    return redo(this.view);
  }
  get canUndo(): boolean {
    return undoDepth(this.view.state) > 0;
  }
  get canRedo(): boolean {
    return redoDepth(this.view.state) > 0;
  }

  setWrap(wrap: boolean): void {
    this.view.dispatch({ effects: this.wrapping.reconfigure(wrap ? EditorView.lineWrapping : []) });
  }

  setSyntax(language: Language | null): void {
    const usable = language && canColour(this.text()) ? language : null;
    if (usable === this.syntaxLanguage) return;
    this.syntaxLanguage = usable;
    this.view.dispatch({ effects: this.syntax.reconfigure(codeSyntax(usable)) });
  }

  localize(): void {
    this.view.dispatch({ effects: this.language.reconfigure(localized()) });
  }

  focus(): void {
    this.view.focus();
  }

  destroy(): void {
    this.view.destroy();
  }
}
