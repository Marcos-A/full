import { detectDelimiter, parseCsv } from './csv';

self.onmessage = (event: MessageEvent<{ text: string; delimiter?: string }>) => {
  const { text, delimiter } = event.data;
  const chosen = delimiter ?? detectDelimiter(text);
  self.postMessage({ delimiter: chosen, ...parseCsv(text, chosen) });
};
