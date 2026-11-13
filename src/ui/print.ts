import type { OpenDoc } from '../doc/OpenDoc';

/**
 * Printing shows only #print-root, built just before printing and removed after, never the app's
 * interface: CodeMirror keeps only the visible lines in the page, so printing the editor would
 * print one screenful. "Print or save as PDF…" builds it asynchronously (src/export/print.ts). The
 * browser's own File > Print gives no time for that, so this builds a plainer one synchronously.
 */

const ROOT_ID = 'print-root';
let savedTitle: string | null = null;

const stem = (name: string) => name.replace(/\.[^.]*$/, '') || name;

/** Chrome and Safari name the PDF after the page's title. */
export function showForPrint(content: Node, name: string): void {
  clearPrint();
  const root = document.createElement('div');
  root.id = ROOT_ID;
  root.append(content);
  document.body.append(root);
  savedTitle = document.title;
  document.title = stem(name);
}

export function clearPrint(): void {
  document.getElementById(ROOT_ID)?.remove();
  if (savedTitle !== null) {
    document.title = savedTitle;
    savedTitle = null;
  }
}

export function plainTextForPrint(text: string): HTMLElement {
  const pre = document.createElement('pre');
  pre.className = 'print-text';
  pre.textContent = text;
  return pre;
}

/** For File > Print: what's on screen, from the rendered side if there is one, and the source text otherwise. */
function buildNow(doc: OpenDoc | null): void {
  if (document.getElementById(ROOT_ID)) return;
  if (!doc) {
    showForPrint(document.createElement('div'), document.title);
    return;
  }
  doc.flushEditors();
  const renderedDom = doc.kind === 'markdown' ? doc.rendered?.dom : null;
  if (renderedDom) {
    const copy = renderedDom.cloneNode(true) as HTMLElement;
    copy.removeAttribute('contenteditable');
    copy.className = 'print-markdown';
    showForPrint(copy, doc.name);
  } else {
    showForPrint(plainTextForPrint(doc.source ? doc.source.text() : doc.currentText()), doc.name);
  }
}

export function installPrintFallback(activeDoc: () => OpenDoc | null): void {
  window.addEventListener('beforeprint', () => buildNow(activeDoc()));
  window.addEventListener('afterprint', clearPrint);
}
