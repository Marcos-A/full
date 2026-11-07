import { WORKER_PARSE_THRESHOLD } from '../config';
import { CsvParseResult, detectDelimiter, parseCsv } from './csv';

export interface ParsedCsv extends CsvParseResult {
  delimiter: string;
}

/** Large files parse on a worker; if that can't start, parse here rather than fail to open. */
export function parseCsvFile(text: string, delimiter?: string): Promise<ParsedCsv> {
  const inline = (): ParsedCsv => {
    const chosen = delimiter ?? detectDelimiter(text);
    return { delimiter: chosen, ...parseCsv(text, chosen) };
  };
  if (text.length < WORKER_PARSE_THRESHOLD || typeof Worker === 'undefined') {
    return Promise.resolve(inline());
  }
  return new Promise((resolve) => {
    try {
      const worker = new Worker(new URL('./csvWorker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent<ParsedCsv>) => {
        worker.terminate();
        resolve(event.data);
      };
      worker.onerror = () => {
        worker.terminate();
        resolve(inline());
      };
      worker.postMessage({ text, delimiter });
    } catch {
      resolve(inline());
    }
  });
}
