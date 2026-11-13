import { defaultValueCtx, Editor, parserCtx, rootCtx, schemaCtx } from '@milkdown/kit/core';
import { commonmark, syncHeadingIdPlugin } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import { DOMSerializer, Fragment, Node as ProseNode, Schema } from '@milkdown/kit/prose/model';
import { splitBlocks } from '../core/markdownParts';

/**
 * Markdown to a standalone HTML page, for "Export as HTML" and for printing. Loaded with import()
 * on first use. It serializes with the schema's own toDOM, never the editor's DOM, so the result
 * has no node views, placeholders, contenteditable or editor classes.
 */

interface Parser {
  parse: (markdown: string) => ProseNode;
  schema: Schema;
}

let parser: Promise<Parser> | null = null;

/** One editor with no view to speak of, made on the first export and kept for the next one. */
function headlessParser(): Promise<Parser> {
  parser ??= (async () => {
    const editor = Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, document.createElement('div'));
        ctx.set(defaultValueCtx, '');
      })
      .use(commonmark.filter((plugin) => plugin !== syncHeadingIdPlugin))
      .use(gfm);
    await editor.create();
    let result: Parser | null = null;
    editor.action((ctx) => {
      result = { parse: ctx.get(parserCtx), schema: ctx.get(schemaCtx) };
    });
    return result!;
  })();
  return parser;
}

const SECTION_THRESHOLD = 100 * 1024;

/** A big file parses section by section and yields between them, as the rendered side does. */
async function parseDocument({ parse, schema }: Parser, markdown: string): Promise<ProseNode> {
  const blocks = markdown.length > SECTION_THRESHOLD ? splitBlocks(markdown) : [markdown];
  if (blocks.length < 2) return parse(markdown);
  const nodes: ProseNode[] = [];
  let sliceStart = performance.now();
  for (const block of blocks) {
    if (performance.now() - sliceStart > 12) {
      await new Promise((resolve) => setTimeout(resolve));
      sliceStart = performance.now();
    }
    parse(block).forEach((child) => nodes.push(child));
  }
  return schema.topNodeType.create(null, Fragment.fromArray(nodes));
}

/** The ids the rendered side gives headings, so in-page links keep working. */
function headingIds(root: HTMLElement): void {
  const seen = new Map<string, number>();
  for (const heading of Array.from(root.querySelectorAll('h1, h2, h3, h4, h5, h6'))) {
    const text = heading.textContent ?? '';
    if (text.trim() === '') {
      heading.removeAttribute('id');
      continue;
    }
    let id = text.toLowerCase().trim().replace(/\s+/g, '-');
    const count = (seen.get(id) ?? 0) + 1;
    seen.set(id, count);
    if (count > 1) id += `-#${count}`;
    heading.id = id;
  }
}

function tidy(root: HTMLElement): void {
  // Task boxes are drawn with CSS in the app. A real box survives pasting into Word or a missing stylesheet.
  for (const item of Array.from(root.querySelectorAll<HTMLElement>('li[data-item-type="task"]'))) {
    const box = root.ownerDocument.createElement('input');
    box.type = 'checkbox';
    box.disabled = true;
    if (item.dataset.checked === 'true') box.setAttribute('checked', '');
    const first = item.firstElementChild;
    const target = first?.tagName === 'P' ? first : item;
    target.prepend(box, ' ');
    item.className = 'task';
  }
  // Raw HTML shows as code in the rendered side, never as HTML, and the export keeps it that way.
  for (const raw of Array.from(root.querySelectorAll('span[data-type="html"]'))) {
    const code = root.ownerDocument.createElement('code');
    code.textContent = raw.textContent;
    raw.replaceWith(code);
  }
  for (const pre of Array.from(root.querySelectorAll<HTMLElement>('pre[data-language]'))) {
    const language = (pre.dataset.language ?? '').replace(/[^\w+#.-]/g, '');
    const code = pre.querySelector('code');
    if (code && language) code.className = `language-${language}`;
  }
  // Unsafe links were emptied by the schema. An empty href would link to the page itself.
  for (const link of Array.from(root.querySelectorAll('a[href=""]'))) link.removeAttribute('href');
  for (const titled of Array.from(root.querySelectorAll('[title=""]'))) titled.removeAttribute('title');
  for (const element of Array.from(root.querySelectorAll('*'))) {
    for (const name of element.getAttributeNames()) if (name.startsWith('data-')) element.removeAttribute(name);
  }
  headingIds(root);
}

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Based on the rendered side's rules, with system colours so the page follows its reader's theme. */
const PAGE_STYLE = `
:root { color-scheme: light dark; }
body {
  max-width: 46rem; margin: 0 auto; padding: 2rem 1.25rem 4rem;
  font: 16px/1.6 system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  background: Canvas; color: CanvasText; overflow-wrap: anywhere;
}
h1, h2, h3, h4, h5, h6 { line-height: 1.3; margin: 1.4em 0 0.5em; font-weight: 600; }
h1 { font-size: 1.7em; }
h2 { font-size: 1.35em; }
h3 { font-size: 1.15em; }
p, ul, ol, blockquote, pre, table { margin: 0 0 0.9em; }
a { color: LinkText; }
code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace; font-size: 0.88em; }
code { padding: 0.1em 0.3em; border-radius: 3px; background: color-mix(in srgb, CanvasText 8%, transparent); }
pre { padding: 0.75em 1em; border-radius: 4px; overflow-x: auto; background: color-mix(in srgb, CanvasText 6%, transparent); }
pre code { padding: 0; background: none; font-size: 1em; }
blockquote { padding-left: 1em; border-left: 3px solid color-mix(in srgb, CanvasText 25%, transparent); color: color-mix(in srgb, CanvasText 75%, transparent); }
ul, ol { padding-left: 1.6em; }
li > p { margin: 0 0 0.25em; }
li.task { list-style: none; }
li.task input { margin: 0 0.4em 0 -1.3em; vertical-align: -0.1em; }
table { border-collapse: collapse; display: block; overflow-x: auto; }
th, td { padding: 0.3em 0.7em; border: 1px solid color-mix(in srgb, CanvasText 22%, transparent); }
th { font-weight: 600; background: color-mix(in srgb, CanvasText 5%, transparent); }
th p, td p { margin: 0; }
hr { border: 0; border-top: 1px solid color-mix(in srgb, CanvasText 22%, transparent); margin: 1.5em 0; }
img { max-width: 100%; }
@media print {
  body { max-width: none; padding: 0; }
  pre, blockquote, tr, img { break-inside: avoid; }
  h1, h2, h3, h4, h5, h6 { break-after: avoid; }
}
`;

export interface ExportedHtml {
  /** The whole page, UTF-8 with LF line endings. */
  page: string;
  /** The document's content, for printing. It belongs to an inert document, so nothing in it has loaded. */
  body: HTMLElement;
}

export async function markdownToHtml(markdown: string, name: string): Promise<ExportedHtml> {
  const ready = await headlessParser();
  const doc = await parseDocument(ready, markdown);
  // An inert document: nothing in it loads, so serializing makes no request for remote images.
  const inert = document.implementation.createHTMLDocument('');
  const body = inert.createElement('div');
  body.append(DOMSerializer.fromSchema(ready.schema).serializeFragment(doc.content, { document: inert }));
  tidy(body);
  const title = name.replace(/\.[^.]*$/, '') || name;
  const page = [
    '<!doctype html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>${PAGE_STYLE}</style>`,
    '</head>',
    '<body>',
    Array.from(body.children, (block) => block.outerHTML).join('\n'),
    '</body>',
    '</html>',
    '',
  ].join('\n');
  return { page: page.replace(/\r\n?/g, '\n'), body };
}
