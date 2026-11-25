import { lazy, Suspense, useEffect } from 'react';
import { OpenDoc } from '../doc/OpenDoc';
import { CsvGrid } from './CsvGrid';
import { SplitView } from './MarkdownPane';

// Not in the main bundle: fetched once a table is on screen and the page is idle, so that it's
// ready by the time Find is pressed.
const loadFindBar = () => import('./CsvFind');
const CsvFindBar = lazy(loadFindBar);
let prefetched = false;

function usePrefetchedFindBar(): void {
  useEffect(() => {
    if (prefetched) return;
    prefetched = true;
    const idle = window.requestIdleCallback ?? ((run: () => void) => window.setTimeout(run, 2000));
    idle(() => void loadFindBar());
  }, []);
}

export function CsvView({ doc }: { doc: OpenDoc }) {
  usePrefetchedFindBar();
  if (doc.csvMode === 'raw' && doc.source) return <SplitView doc={doc} />;
  // The grid keeps its place whether the bar is there or not, so opening the bar doesn't rebuild it.
  return (
    <>
      {doc.gridFind && (
        <Suspense fallback={null}>
          <CsvFindBar doc={doc} />
        </Suspense>
      )}
      <CsvGrid doc={doc} />
    </>
  );
}
