import { useEffect, useState } from 'react';
import { ENCODING_LABELS } from '../core/encoding';
import { ws } from '../doc/workspace';
import { S } from '../strings';

interface BuildInfo {
  environment?: string;
  build?: { sha?: string; shortSha?: string };
  release?: { tag?: string } | null;
}

function useBuildInfo(): { label: string; title: string } {
  const [info, setInfo] = useState({ label: S.buildUnknown, title: S.buildUnknown });
  useEffect(() => {
    fetch('/build-info.json', { cache: 'no-cache' })
      .then((response) => (response.ok ? (response.json() as Promise<BuildInfo>) : null))
      .then((data) => {
        const short = data?.build?.shortSha;
        if (!short || !data?.build?.sha) return;
        const environment = data.environment ?? 'production';
        const tag = data.release?.tag ?? null;
        const label =
          environment === 'preview' ? `Preview · ${short}` : tag ? `${tag} · ${short}` : `Build ${short}`;
        setInfo({ label, title: S.buildTitle(tag, data.build.sha, environment) });
      })
      .catch(() => undefined);
  }, []);
  return info;
}

export function StatusBar() {
  const doc = ws.active;
  const build = useBuildInfo();
  const openPalette = (query: string) => {
    ws.paletteQuery = query;
    ws.bump();
  };
  let counts: string | null = null;
  if (doc?.kind === 'csv') {
    if (doc.csvMode === 'grid') counts = S.rowsColumns(doc.csv!.rows.length, doc.csv!.columnCount);
    else if (doc.rawRowCount !== null) counts = S.rowsColumns(doc.rawRowCount, doc.rawColumnCount ?? 0);
  }
  return (
    <footer className="statusbar" data-testid="statusbar">
      {doc && (
        <>
          <span data-testid="status-kind">{S.kindNames[doc.kind]}</span>
          <button className="status-item" data-testid="status-encoding" onClick={() => openPalette('Reopen')}>
            {ENCODING_LABELS[doc.encoding]}
            {doc.hasBom ? ' BOM' : ''}
          </button>
          <span data-testid="status-eol">{S.lineEndingNames[doc.lineEnding]}</span>
          {doc.kind === 'csv' && (
            <button className="status-item" data-testid="status-delimiter" onClick={() => openPalette('delimiter')}>
              {S.delimiterNames[doc.csv!.delimiter]}
            </button>
          )}
          {counts && <span data-testid="status-counts">{counts}</span>}
          {doc.lineEnding === 'mixed' && (
            <span className="status-warning" data-testid="status-mixed">
              {S.mixedNotice}
            </span>
          )}
          {doc.lossy && <span className="status-warning">{S.lossyNotice}</span>}
        </>
      )}
      <span className="status-build" title={build.title} data-testid="build-info">
        {build.label}
      </span>
    </footer>
  );
}
