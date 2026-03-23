/** Escape HTML to prevent XSS in popup content. */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export const getDeps = (deps: string | string[]): string[] => {
  return Array.isArray(deps)
    ? deps
    : String(deps)
        .split(',')
        .map((d) => d.trim())
        .filter(Boolean);
};
