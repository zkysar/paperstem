export const GITHUB_REPO_URL = 'https://github.com/zkysar/paperstem';

export function githubUrlForVersion(version: string): string {
  const m = version.match(/^dev-([0-9a-f]{7,40})$/i);
  if (m) return `${GITHUB_REPO_URL}/commit/${m[1]}`;
  if (/^v\d/.test(version)) return `${GITHUB_REPO_URL}/tree/${encodeURIComponent(version)}`;
  return GITHUB_REPO_URL;
}
