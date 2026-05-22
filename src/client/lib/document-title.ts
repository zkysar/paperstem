// Builds the `document.title`. The base carries the env prefix (e.g.
// "[LOCAL] Paperstem") so non-prod tabs stay distinguishable; an open project
// is prepended so screen-reader and tab-title users can tell projects apart.
export function buildDocumentTitle(
  env: string | null | undefined,
  projectTitle?: string | null,
): string {
  const base = env && env !== 'prod' ? `[${env.toUpperCase()}] Paperstem` : 'Paperstem';
  return projectTitle ? `${projectTitle} — ${base}` : base;
}
