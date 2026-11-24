import { OpenDoc } from '../doc/OpenDoc';
import { CsvGrid } from './CsvGrid';
import { SplitView } from './MarkdownPane';

export function CsvView({ doc }: { doc: OpenDoc }) {
  if (doc.csvMode === 'raw' && doc.source) return <SplitView doc={doc} />;
  return <CsvGrid doc={doc} />;
}
