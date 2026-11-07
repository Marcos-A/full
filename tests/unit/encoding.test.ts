import { describe, expect, it } from 'vitest';
import { decodeAs, detectAndDecode, encodeText, findUnencodable, UnencodableError } from '../../src/core/encoding';

const roundTrip = (bytes: Uint8Array) => {
  const d = detectAndDecode(bytes);
  return { d, out: encodeText(d.text, d.encoding, d.hasBom) };
};

describe('encoding detection and round trip', () => {
  it('UTF-8 without a BOM', () => {
    const bytes = new TextEncoder().encode('Català à é\r\nsecond');
    const { d, out } = roundTrip(bytes);
    expect(d.encoding).toBe('utf-8');
    expect(d.hasBom).toBe(false);
    expect(out).toEqual(bytes);
  });

  it('UTF-8 with a BOM keeps it and hides it from the text', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x61, 0xc3, 0xa9]);
    const { d, out } = roundTrip(bytes);
    expect(d).toMatchObject({ encoding: 'utf-8', hasBom: true, text: 'aé' });
    expect(out).toEqual(bytes);
  });

  it.each([
    ['utf-16le', [0xff, 0xfe, 0x61, 0x00, 0xe9, 0x00, 0x3d, 0xd8, 0x00, 0xde]],
    ['utf-16be', [0xfe, 0xff, 0x00, 0x61, 0x00, 0xe9, 0xd8, 0x3d, 0xde, 0x00]],
  ])('%s with BOM, including a surrogate pair', (encoding, raw) => {
    const bytes = new Uint8Array(raw);
    const { d, out } = roundTrip(bytes);
    expect(d.encoding).toBe(encoding);
    expect(d.text).toBe('aé😀');
    expect(out).toEqual(bytes);
  });

  it('falls back to Windows-1252 and reads Catalan and Spanish characters', () => {
    const bytes = new Uint8Array([0xe0, 0x2c, 0xe9, 0x2c, 0xe7, 0x2c, 0xf1, 0x2c, 0xb7, 0x80]);
    const { d, out } = roundTrip(bytes);
    expect(d.encoding).toBe('windows-1252');
    expect(d.text).toBe('à,é,ç,ñ,·€');
    expect(out).toEqual(bytes);
  });

  it('round-trips every byte value through Windows-1252, including the undefined ones', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    const d = decodeAs(bytes, 'windows-1252');
    expect(encodeText(d.text, 'windows-1252', false)).toEqual(bytes);
  });

  it('reports invalid UTF-16 as lossy instead of hiding it', () => {
    expect(decodeAs(new Uint8Array([0xff, 0xfe, 0x00, 0xd8]), 'utf-16le').lossy).toBe(true);
  });
});

describe('unrepresentable characters', () => {
  it('finds a character Windows-1252 lacks and refuses to substitute it', () => {
    expect(findUnencodable('abc → d', 'windows-1252')).toEqual({ char: '→', index: 4 });
    expect(() => encodeText('→', 'windows-1252', false)).toThrow(UnencodableError);
  });
  it('accepts what Windows-1252 has', () => {
    expect(findUnencodable('à é ç ñ · € “”', 'windows-1252')).toBeNull();
  });
  it('rejects lone surrogates for UTF-8, which would otherwise be replaced', () => {
    expect(findUnencodable('a\ud83d', 'utf-8')?.index).toBe(1);
    expect(findUnencodable('😀', 'utf-8')).toBeNull();
  });
});
