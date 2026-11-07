const BASE = 'https://relative.invalid/';

function parse(href: string): URL | null {
  try {
    return new URL(href.trim(), BASE);
  } catch {
    return null;
  }
}

/** The URL parser removes tabs and line breaks, so "java\nscript:" can't slip through. */
export function isRelative(url: URL): boolean {
  return url.hostname === 'relative.invalid';
}

export type LinkClass = 'external' | 'anchor' | 'relative' | 'blocked';

export function classifyLink(href: string): LinkClass {
  if (href.trim().startsWith('#')) return 'anchor';
  const url = parse(href);
  if (!url) return 'blocked';
  if (isRelative(url)) return 'relative';
  return ['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol) ? 'external' : 'blocked';
}

export type ImageClass = 'remote' | 'data' | 'relative' | 'blocked';

export function classifyImage(src: string): ImageClass {
  const url = parse(src);
  if (!url) return 'blocked';
  if (isRelative(url)) return 'relative';
  if (url.protocol === 'https:') return 'remote';
  if (url.protocol === 'data:' && /^data:image\/(png|jpe?g|gif|webp|avif|bmp);/i.test(src.trim())) return 'data';
  return 'blocked';
}
