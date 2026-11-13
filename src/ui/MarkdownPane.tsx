import { useEffect, useRef } from 'react';
import { OpenDoc } from '../doc/OpenDoc';
import { RenderedPane } from '../doc/RenderedPane';
import { SourcePane } from '../doc/SourcePane';
import { ws } from '../doc/workspace';
import { language, S } from '../strings';

export function SourceHost({ pane }: { pane: SourcePane }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = ref.current!;
    host.append(pane.view.dom);
    pane.view.requestMeasure();
    return () => pane.view.dom.remove();
  }, [pane]);
  return <div ref={ref} className="source-host" data-testid="source" />;
}

function useScrollSync(doc: OpenDoc, renderedScroller: React.RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    const source = doc.source?.view.scrollDOM;
    const rendered = renderedScroller.current;
    if (!source || !rendered) return;
    let ignore: HTMLElement | null = null;
    const sync = (from: HTMLElement, to: HTMLElement) => () => {
      if (ignore === from) {
        ignore = null;
        return;
      }
      if (doc.viewMode !== 'split') return;
      const range = from.scrollHeight - from.clientHeight;
      if (range <= 0) return;
      ignore = to;
      to.scrollTop = (from.scrollTop / range) * (to.scrollHeight - to.clientHeight);
    };
    const fromSource = sync(source, rendered);
    const fromRendered = sync(rendered, source);
    source.addEventListener('scroll', fromSource, { passive: true });
    rendered.addEventListener('scroll', fromRendered, { passive: true });
    return () => {
      source.removeEventListener('scroll', fromSource);
      rendered.removeEventListener('scroll', fromRendered);
    };
  }, [doc, doc.source, renderedScroller]);
}

interface SplitViewProps {
  doc: OpenDoc;
  /** The right-hand side, which shows the file rather than editing its text. */
  children: React.ReactNode;
  sideClass: string;
  sideTestId: string;
  sideRef?: React.RefObject<HTMLDivElement | null>;
}

/** The source and its rendered side, with the divider between them. Shared by Markdown and HTML. */
export function SplitView({ doc, children, sideClass, sideTestId, sideRef }: SplitViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const startDrag = (event: React.PointerEvent) => {
    event.preventDefault();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => {
      const box = containerRef.current!.getBoundingClientRect();
      doc.splitRatio = Math.min(0.85, Math.max(0.15, (e.clientX - box.left) / box.width));
      ws.bump();
    };
    const up = () => {
      target.removeEventListener('pointermove', move as EventListener);
      target.removeEventListener('pointerup', up);
    };
    target.addEventListener('pointermove', move as EventListener);
    target.addEventListener('pointerup', up);
  };

  const resizeByKey = (event: React.KeyboardEvent) => {
    const step = event.key === 'ArrowLeft' ? -0.02 : event.key === 'ArrowRight' ? 0.02 : 0;
    if (!step) return;
    event.preventDefault();
    doc.splitRatio = Math.min(0.85, Math.max(0.15, doc.splitRatio + step));
    ws.bump();
  };

  const showSource = doc.viewMode !== 'rendered';
  const showRendered = doc.viewMode !== 'source';
  const sourceFlex = doc.viewMode === 'split' ? `0 0 ${doc.splitRatio * 100}%` : '1 1 0';

  return (
    <div className="markdown" ref={containerRef}>
      <div className="pane" style={{ flex: sourceFlex }} hidden={!showSource}>
        <SourceHost pane={doc.source!} />
      </div>
      {doc.viewMode === 'split' && (
        <div
          className="divider"
          role="separator"
          aria-orientation="vertical"
          aria-label={S.resizeSplit}
          aria-valuenow={Math.round(doc.splitRatio * 100)}
          tabIndex={0}
          onPointerDown={startDrag}
          onKeyDown={resizeByKey}
        />
      )}
      <div className={`pane ${sideClass}`} ref={sideRef} hidden={!showRendered} data-testid={sideTestId}>
        {children}
      </div>
    </div>
  );
}

export function MarkdownPane({ doc }: { doc: OpenDoc }) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  useScrollSync(doc, scrollerRef);

  useEffect(() => {
    const pane = new RenderedPane({
      root: rootRef.current!,
      remoteImages: doc.remoteImages,
      canEdit: () => doc.canEditRendered(doc),
      requestEdit: () => doc.requestRenderedEdit(doc),
      onUserEdit: (markdown) => doc.applyRenderedMarkdown(markdown),
      onFocus: () => {
        doc.renderedFocused();
        pane.flushLoad();
      },
    });
    doc.attachRendered(pane);
    return () => doc.detachRendered(pane);
    // The label and image placeholders are written when the pane is built, so a new language rebuilds it.
  }, [doc, doc.remoteImages, doc.source, language]);

  return (
    <SplitView doc={doc} sideClass="rendered-scroll" sideTestId="rendered" sideRef={scrollerRef}>
      {doc.frontMatter && (
        <pre className="front-matter" aria-label={S.frontMatterLabel} data-testid="front-matter">
          {doc.frontMatter}
        </pre>
      )}
      <div className="md-rendered" ref={rootRef} key={String(doc.remoteImages)} />
    </SplitView>
  );
}
