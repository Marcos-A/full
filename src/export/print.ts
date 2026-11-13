import { classifyImage } from '../core/urls';
import type { OpenDoc } from '../doc/OpenDoc';
import { S } from '../strings';
import { plainTextForPrint, showForPrint } from '../ui/print';
import { markdownToHtml } from './html';

/**
 * Images print as they show on screen: data images, and remote ones only once "Load remote images"
 * is on. The rest become the same short note as in the rendered side, so printing never makes a
 * request the screen wouldn't. This runs before the content joins the page, where images would load.
 */
function placeImages(body: HTMLElement, remoteImages: boolean): void {
  for (const img of Array.from(body.querySelectorAll('img'))) {
    const src = img.getAttribute('src') ?? '';
    const kind = classifyImage(src);
    if (kind === 'data' || (kind === 'remote' && remoteImages)) {
      img.referrerPolicy = 'no-referrer';
      continue;
    }
    const note = body.ownerDocument.createElement('span');
    note.className = 'md-image-placeholder';
    note.textContent = kind === 'remote' ? S.imageBlocked(src) : kind === 'relative' ? S.imageRelative(src) : S.imageUnsafe(src);
    img.replaceWith(note);
  }
}

/** Builds what's printed, then opens the system print dialog, whose "Save as PDF" makes the file. */
export async function printDoc(doc: OpenDoc): Promise<void> {
  if (doc.kind === 'markdown') {
    const { body } = await markdownToHtml(doc.markdownBody(), doc.name);
    placeImages(body, doc.remoteImages);
    body.className = 'print-markdown';
    showForPrint(document.adoptNode(body), doc.name);
  } else {
    showForPrint(plainTextForPrint(doc.source ? doc.source.text() : doc.currentText()), doc.name);
  }
  window.print();
}
