export type DocKind = 'csv' | 'markdown' | 'text';

export const SUPPORTED_EXTENSIONS = ['.csv', '.md', '.markdown', '.txt'];

export function kindFromName(name: string): DocKind | null {
  const lower = name.toLowerCase();
  if (lower.endsWith('.csv')) return 'csv';
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'markdown';
  if (lower.endsWith('.txt')) return 'text';
  return null;
}

/** "notes." and ".env" have none: nothing follows the dot, or nothing comes before it. */
export function hasExtension(name: string): boolean {
  const dot = name.lastIndexOf('.');
  return dot > 0 && dot < name.length - 1;
}
