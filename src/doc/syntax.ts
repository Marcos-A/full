import { cssLanguage } from '@codemirror/lang-css';
import { htmlLanguage } from '@codemirror/lang-html';
import { javascriptLanguage, jsxLanguage, tsxLanguage, typescriptLanguage } from '@codemirror/lang-javascript';
import { Language, StreamLanguage } from '@codemirror/language';
import { MAX_HIGHLIGHT_CHARS, MAX_HIGHLIGHT_LINE } from '../config';

type Load = () => Promise<Language>;

const cpp: Load = () => import('@codemirror/lang-cpp').then((m) => m.cppLanguage);
const go: Load = () => import('@codemirror/lang-go').then((m) => m.goLanguage);
const java: Load = () => import('@codemirror/lang-java').then((m) => m.javaLanguage);
const json: Load = () => import('@codemirror/lang-json').then((m) => m.jsonLanguage);
// Its full setup, because that is what colours the HTML around the PHP. Only the grammar is kept.
const php: Load = () => import('@codemirror/lang-php').then((m) => m.php().language);
const python: Load = () => import('@codemirror/lang-python').then((m) => m.pythonLanguage);
const rust: Load = () => import('@codemirror/lang-rust').then((m) => m.rustLanguage);
const shell: Load = () => import('@codemirror/legacy-modes/mode/shell').then((m) => StreamLanguage.define(m.shell));
const xml: Load = () => import('@codemirror/lang-xml').then((m) => m.xmlLanguage);
const yaml: Load = () => import('@codemirror/lang-yaml').then((m) => m.yamlLanguage);

/**
 * To add a language, add a row. JavaScript, HTML and CSS are already part of the app, through
 * Markdown. The rest are fetched when a file needs them, so they cost nothing at startup.
 */
const TABLE: ReadonlyArray<readonly [string, Language | Load]> = [
  ['js mjs cjs', javascriptLanguage],
  ['jsx', jsxLanguage],
  ['ts mts cts', typescriptLanguage],
  ['tsx', tsxLanguage],
  ['html htm xhtml', htmlLanguage],
  ['css', cssLanguage],
  ['py pyw pyi', python],
  ['c h cc cpp cxx hh hpp hxx', cpp],
  ['java', java],
  ['rs', rust],
  ['go', go],
  ['php', php],
  ['json', json],
  ['yaml yml', yaml],
  ['xml svg', xml],
  ['sh bash zsh', shell],
];

const byExtension = new Map(TABLE.flatMap(([extensions, grammar]) => extensions.split(' ').map((e) => [e, grammar] as const)));

const ready = new Map<Load, Language>();
const loading = new Map<Load, Promise<Language | null>>();

function grammarOf(name: string): Language | Load | undefined {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? byExtension.get(name.slice(dot + 1).toLowerCase()) : undefined;
}

/** Colouring a huge file or a very long line would slow typing down, and speed comes first. */
export function canColour(text: string): boolean {
  if (text.length > MAX_HIGHLIGHT_CHARS) return false;
  for (let start = 0; start < text.length; ) {
    const newline = text.indexOf('\n', start);
    const end = newline < 0 ? text.length : newline;
    if (end - start > MAX_HIGHLIGHT_LINE) return false;
    start = end + 1;
  }
  return true;
}

/** The grammar for this file name, if it can be used right now. */
export function loadedGrammar(name: string): Language | null {
  const grammar = grammarOf(name);
  if (!grammar) return null;
  return grammar instanceof Language ? grammar : (ready.get(grammar) ?? null);
}

/** Null if the name has no grammar or it couldn't be fetched: the file then simply stays plain. */
export function loadGrammar(name: string): Promise<Language | null> {
  const loaded = loadedGrammar(name);
  const grammar = grammarOf(name);
  if (loaded || !grammar || grammar instanceof Language) return Promise.resolve(loaded);
  let pending = loading.get(grammar);
  if (!pending) {
    pending = grammar()
      .then(
        (language) => {
          ready.set(grammar, language);
          return language;
        },
        () => null,
      )
      .finally(() => loading.delete(grammar));
    loading.set(grammar, pending);
  }
  return pending;
}

/** Gives a grammar being fetched a moment to arrive, so that the file first appears in colour. */
export async function waitForGrammar(name: string, ms: number): Promise<void> {
  if (loadedGrammar(name) || !grammarOf(name)) return;
  let timer: number | undefined;
  await Promise.race([loadGrammar(name), new Promise((resolve) => (timer = window.setTimeout(resolve, ms)))]);
  window.clearTimeout(timer);
}
