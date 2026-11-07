export interface MarkdownParts {
  /** Exact front matter text including its closing line break, or '' */
  frontMatter: string;
  body: string;
}

const FRONT_MATTER = /^---[ \t]*\n(?:[\s\S]*?\n)?---[ \t]*(?:\n|$)/;

/** Works on editor (LF) text. Front matter never enters the rendered editor, so it can't be reformatted. */
export function splitFrontMatter(text: string): MarkdownParts {
  const match = FRONT_MATTER.exec(text);
  if (!match) return { frontMatter: '', body: text };
  return { frontMatter: match[0], body: text.slice(match[0].length) };
}

/** Source text after a rendered-side edit: same front matter, same final-newline state. */
export function joinRenderedMarkdown(previousSource: string, markdown: string): string {
  const { frontMatter } = splitFrontMatter(previousSource);
  const trimmed = markdown.replace(/\n+$/, '');
  return frontMatter + trimmed + (previousSource.endsWith('\n') ? '\n' : '');
}

/** Smallest single replacement turning a into b, so a rendered edit stays minimal in the history. */
export function minimalChange(a: string, b: string): { from: number; to: number; insert: string } | null {
  if (a === b) return null;
  let start = 0;
  const max = Math.min(a.length, b.length);
  while (start < max && a.charCodeAt(start) === b.charCodeAt(start)) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a.charCodeAt(endA - 1) === b.charCodeAt(endB - 1)) {
    endA--;
    endB--;
  }
  return { from: start, to: endA, insert: b.slice(start, endB) };
}

const BLOCK_SPLIT_THRESHOLD = 100 * 1024;
/** Things that can reach across a heading: reference definitions, footnotes, raw HTML blocks. */
const SPANS_SECTIONS = /^ {0,3}\[[^\]\n]+\]:|<!--|<\?|<![A-Za-z]|<(?:script|pre|style|textarea)[\s>]/im;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * Split big Markdown before each top-level ATX heading outside a code fence. CommonMark lets such
 * a heading interrupt any open block, so parsing the parts gives the same result as parsing the
 * whole. Small documents, and any that could span sections, stay in one piece.
 */
export function splitBlocks(body: string): string[] {
  if (body.length < BLOCK_SPLIT_THRESHOLD || SPANS_SECTIONS.test(body)) return [body];
  const blocks: string[] = [];
  let blockStart = 0;
  let lineStart = 0;
  let fence: string | null = null;
  while (lineStart < body.length) {
    let lineEnd = body.indexOf('\n', lineStart);
    if (lineEnd < 0) lineEnd = body.length;
    const first = body.charCodeAt(lineStart);
    // Only lines starting with a space, ` or ~ can be fences, and only # can start a heading here.
    if (first === 32 || first === 96 || first === 126) {
      const match = FENCE.exec(body.slice(lineStart, Math.min(lineEnd, lineStart + 80)));
      if (match) {
        if (fence === null) fence = match[1];
        else if (match[1][0] === fence[0] && match[1].length >= fence.length) fence = null;
      }
    } else if (first === 35 && fence === null && lineStart > blockStart) {
      if (/^#{1,6}(?: |\t|$)/.test(body.slice(lineStart, Math.min(lineEnd, lineStart + 8)))) {
        blocks.push(body.slice(blockStart, lineStart));
        blockStart = lineStart;
      }
    }
    lineStart = lineEnd + 1;
  }
  if (blockStart < body.length) blocks.push(body.slice(blockStart));
  return blocks;
}
