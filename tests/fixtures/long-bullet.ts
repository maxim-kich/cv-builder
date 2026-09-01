export const LONG_BULLET_SUFFIX =
  " This deliberately extended verification sentence checks that a substantially longer achievement wraps across several visual lines without clipping, overlap, lost text, or a detached bullet marker.";

export function withLongBullet(markdown: string): string {
  return markdown.replace(/^- (.+)$/m, (line) => `${line}${LONG_BULLET_SUFFIX}`);
}
