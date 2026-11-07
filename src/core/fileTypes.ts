export type DocKind = 'csv' | 'markdown' | 'text';

export const SUPPORTED_EXTENSIONS = ['.csv', '.md', '.markdown', '.txt'];

export function kindFromName(name: string): DocKind | null {
  const lower = name.toLowerCase();
  if (lower.endsWith('.csv')) return 'csv';
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'markdown';
  if (lower.endsWith('.txt')) return 'text';
  return null;
}
