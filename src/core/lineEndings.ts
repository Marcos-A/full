export type LineEnding = 'lf' | 'crlf' | 'cr' | 'mixed';
export type PureEnding = Exclude<LineEnding, 'mixed'>;

export interface LineEndingInfo {
  ending: LineEnding;
  dominant: PureEnding;
}

export function detectLineEndings(text: string): LineEndingInfo {
  let lf = 0;
  let crlf = 0;
  let cr = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 10) lf++;
    else if (c === 13) {
      if (text.charCodeAt(i + 1) === 10) {
        crlf++;
        i++;
      } else cr++;
    }
  }
  const kinds = (lf > 0 ? 1 : 0) + (crlf > 0 ? 1 : 0) + (cr > 0 ? 1 : 0);
  const dominant: PureEnding = crlf >= lf && crlf >= cr && crlf > 0 ? 'crlf' : lf >= cr ? 'lf' : 'cr';
  return { ending: kinds > 1 ? 'mixed' : dominant, dominant };
}

export const eolString = (ending: PureEnding): string =>
  ending === 'crlf' ? '\r\n' : ending === 'cr' ? '\r' : '\n';

/** Editors work on LF text. Only used in memory: the file form is kept separately. */
export const toEditorText = (text: string): string =>
  text.indexOf('\r') < 0 ? text : text.replace(/\r\n?/g, '\n');

export const fromEditorText = (text: string, ending: PureEnding): string =>
  ending === 'lf' ? text : text.replace(/\n/g, eolString(ending));
