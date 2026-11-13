import { buildXlsx, XlsxInput, XlsxLimitError } from './xlsx';

/** Builds the workbook off the main thread, so a 100,000-row export never holds up typing. */
self.onmessage = async (event: MessageEvent<XlsxInput>) => {
  try {
    const bytes = await buildXlsx(event.data);
    self.postMessage({ bytes }, { transfer: [bytes.buffer] });
  } catch (error) {
    self.postMessage(
      error instanceof XlsxLimitError ? { limit: error.detail } : { error: error instanceof Error ? error.message : String(error) },
    );
  }
};
