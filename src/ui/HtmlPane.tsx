import { useEffect, useRef } from 'react';
import type { OpenDoc } from '../doc/OpenDoc';
import type { HtmlPreview } from '../doc/htmlPreview';
import { ws } from '../doc/workspace';
import { host } from '../platform/host';
import { language } from '../strings';
import { SplitView } from './MarkdownPane';

/** Hands a key press from inside the preview to the app's own shortcuts. True if one took it. */
function forwardKey(event: KeyboardEvent): boolean {
  const copy = new KeyboardEvent('keydown', {
    key: event.key,
    code: event.code,
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    shiftKey: event.shiftKey,
    repeat: event.repeat,
    bubbles: true,
    cancelable: true,
  });
  window.dispatchEvent(copy);
  return copy.defaultPrevented;
}

/** The preview frame exists only while it's on screen in the active tab, so there's never more than one. */
function PreviewFrame({ doc }: { doc: OpenDoc }) {
  const ref = useRef<HTMLDivElement>(null);
  const preview = useRef<HtmlPreview | null>(null);

  useEffect(() => {
    let cancelled = false;
    void import('../doc/htmlPreview').then(({ HtmlPreview }) => {
      if (cancelled || !ref.current) return;
      const created = new HtmlPreview(ref.current, {
        remoteImages: doc.remoteImages,
        text: () => doc.source!.text(),
        length: () => doc.source!.length,
        openLink: (href) => host().openExternal(href),
        forwardKey,
      });
      preview.current = created;
      created.show();
      doc.previewListener = () => created.schedule();
    });
    return () => {
      cancelled = true;
      preview.current?.destroy();
      preview.current = null;
      doc.previewListener = null;
    };
  }, [doc, doc.source, doc.remoteImages, language]);

  // A file too large to follow typing shows what was saved, once it's saved.
  useEffect(() => preview.current?.show(), [doc.lastSavedText]);

  return <div className="html-preview" ref={ref} />;
}

export function HtmlPane({ doc }: { doc: OpenDoc }) {
  const visible = doc.viewMode !== 'source' && ws.activeId === doc.id;
  return (
    <SplitView doc={doc} sideClass="html-preview-pane" sideTestId="preview">
      {visible && <PreviewFrame doc={doc} />}
    </SplitView>
  );
}
