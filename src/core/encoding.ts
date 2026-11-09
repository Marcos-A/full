export type EncodingName = 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252';

export const ENCODINGS: EncodingName[] = ['utf-8', 'utf-16le', 'utf-16be', 'windows-1252'];

export const ENCODING_LABELS: Record<EncodingName, string> = {
  'utf-8': 'UTF-8',
  'utf-16le': 'UTF-16 LE',
  'utf-16be': 'UTF-16 BE',
  'windows-1252': 'Windows-1252',
};

const BOMS: Partial<Record<EncodingName, number[]>> = {
  'utf-8': [0xef, 0xbb, 0xbf],
  'utf-16le': [0xff, 0xfe],
  'utf-16be': [0xfe, 0xff],
};

export interface Decoded {
  text: string;
  encoding: EncodingName;
  hasBom: boolean;
  /** Invalid sequences were replaced while decoding, so an edited save cannot restore them. */
  lossy: boolean;
}

function startsWith(bytes: Uint8Array, prefix: number[] | undefined): boolean {
  if (!prefix || bytes.length < prefix.length) return false;
  return prefix.every((b, i) => bytes[i] === b);
}

/** Decode as a specific encoding. A BOM is only consumed if it belongs to that encoding. */
export function decodeAs(bytes: Uint8Array, encoding: EncodingName): Decoded {
  const hasBom = startsWith(bytes, BOMS[encoding]);
  const body = hasBom ? bytes.subarray(BOMS[encoding]!.length) : bytes;
  try {
    const text = new TextDecoder(encoding, { fatal: true, ignoreBOM: true }).decode(body);
    return { text, encoding, hasBom, lossy: false };
  } catch {
    const text = new TextDecoder(encoding, { ignoreBOM: true }).decode(body);
    return { text, encoding, hasBom, lossy: true };
  }
}

/** Text has no NUL bytes unless it's UTF-16, which a BOM announces. The check git uses, near enough. */
export function looksBinary(bytes: Uint8Array): boolean {
  if (startsWith(bytes, BOMS['utf-16le']) || startsWith(bytes, BOMS['utf-16be'])) return false;
  return bytes.subarray(0, 8000).includes(0);
}

/** Detection order: BOM, strict UTF-8, then Windows-1252. */
export function detectAndDecode(bytes: Uint8Array): Decoded {
  for (const encoding of ['utf-8', 'utf-16le', 'utf-16be'] as EncodingName[]) {
    if (startsWith(bytes, BOMS[encoding])) return decodeAs(bytes, encoding);
  }
  const utf8 = decodeAs(bytes, 'utf-8');
  return utf8.lossy ? decodeAs(bytes, 'windows-1252') : utf8;
}

let table1252: Map<number, number> | null = null;

/** Built from the decoder so that encoding is its exact inverse, including 0x81 and friends. */
function get1252Table(): Map<number, number> {
  if (table1252) return table1252;
  const decoder = new TextDecoder('windows-1252');
  const map = new Map<number, number>();
  for (let b = 0; b < 256; b++) map.set(decoder.decode(new Uint8Array([b])).charCodeAt(0), b);
  table1252 = map;
  return map;
}

export interface Unencodable {
  char: string;
  index: number;
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** First character the encoding cannot represent, or null. Saving must stop if this is not null. */
export function findUnencodable(text: string, encoding: EncodingName): Unencodable | null {
  if (encoding === 'windows-1252') {
    const table = get1252Table();
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code < 0x80) continue;
      if (!table.has(code)) {
        const point = text.codePointAt(i)!;
        return { char: String.fromCodePoint(point), index: i };
      }
    }
    return null;
  }
  if (encoding === 'utf-8') {
    const match = LONE_SURROGATE.exec(text);
    if (match) return { char: match[0], index: match.index };
  }
  return null;
}

export class UnencodableError extends Error {
  constructor(readonly detail: Unencodable, readonly encoding: EncodingName) {
    super(`Cannot encode U+${detail.char.codePointAt(0)!.toString(16)} as ${encoding}`);
  }
}

/** Throws rather than substituting a character. */
export function encodeText(text: string, encoding: EncodingName, hasBom: boolean): Uint8Array {
  const bad = findUnencodable(text, encoding);
  if (bad) throw new UnencodableError(bad, encoding);
  const bom = hasBom ? (BOMS[encoding] ?? []) : [];
  let body: Uint8Array;
  if (encoding === 'utf-8') {
    body = new TextEncoder().encode(text);
  } else if (encoding === 'windows-1252') {
    const table = get1252Table();
    body = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      body[i] = code < 0x80 ? code : table.get(code)!;
    }
  } else {
    const little = encoding === 'utf-16le';
    body = new Uint8Array(text.length * 2);
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      body[i * 2] = little ? code & 0xff : code >> 8;
      body[i * 2 + 1] = little ? code >> 8 : code & 0xff;
    }
  }
  if (bom.length === 0) return body;
  const out = new Uint8Array(bom.length + body.length);
  out.set(bom);
  out.set(body, bom.length);
  return out;
}
