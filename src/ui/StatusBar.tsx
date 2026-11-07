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
  const themeLabel = ws.effectiveTheme() === 'dark' ? S.switchToLight : S.switchToDark;
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
      <button
        className="status-item status-accent"
        data-testid="accent-button"
        aria-label={S.changeAccent}
        title={S.changeAccent}
        onClick={() => openPalette('Accent')}
      >
        <i className="swatch" />
      </button>
      <button
        className="status-item status-theme"
        data-testid="theme-toggle"
        aria-label={themeLabel}
        title={themeLabel}
        onClick={() => ws.toggleTheme()}
      >
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
          <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 1.5a6.5 6.5 0 0 1 0 13z" fill="currentColor" />
        </svg>
      </button>
    </footer>
  );
}
