/** `notes.md` becomes `notes.html`, and `untitled` becomes `untitled.html`. */
export function exportName(name: string, format: 'html' | 'xlsx'): string {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  return `${stem}.${format}`;
}
