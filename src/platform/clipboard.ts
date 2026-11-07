export async function writeClipboard(html: string | null, plain: string): Promise<void> {
  if (html !== null && 'ClipboardItem' in window && navigator.clipboard?.write) {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/plain': new Blob([plain], { type: 'text/plain' }),
        'text/html': new Blob([html], { type: 'text/html' }),
      }),
    ]);
    return;
  }
  await navigator.clipboard.writeText(plain);
}
