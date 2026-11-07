import { OpenDoc } from '../doc/OpenDoc';
import { CsvGrid } from './CsvGrid';
import { SourceHost } from './MarkdownPane';

export function CsvView({ doc }: { doc: OpenDoc }) {
  if (doc.csvMode === 'raw' && doc.source) return <SourceHost pane={doc.source} />;
  return <CsvGrid doc={doc} />;
}
