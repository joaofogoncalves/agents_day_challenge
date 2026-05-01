/**
 * GitHub profile snapshot for skill inference.
 *
 * Fetches the public repos list for a handle and derives:
 *   - langs: deduplicated list of repo languages (sorted by frequency)
 *   - recentRepos: name + description of the 10 most recently updated repos
 *   - summary: plain-text representation ready to pass to skills.extractSkills()
 *
 * Anonymous unless a GITHUB_TOKEN is provided (higher rate limit).
 */

export type GithubProfile = {
  langs: string[];
  recentRepos: Array<{ name: string; description: string }>;
  summary: string;
};

export async function profile(
  handle: string,
  token?: string,
): Promise<GithubProfile | null> {
  const headers: Record<string, string> = {
    "user-agent": "Quorum/0.1",
    accept: "application/vnd.github+json",
  };
  if (token) headers.authorization = `Bearer ${token}`;

  let list: Array<{ name: string; language: string | null; description: string | null }>;
  try {
    const res = await fetch(
      `https://api.github.com/users/${encodeURIComponent(handle)}/repos?per_page=30&sort=updated`,
      { headers },
    );
    if (!res.ok) return null;
    list = (await res.json()) as typeof list;
  } catch {
    return null;
  }

  // Count language frequency then sort descending.
  const freq = new Map<string, number>();
  for (const r of list) {
    if (r.language) freq.set(r.language, (freq.get(r.language) ?? 0) + 1);
  }
  const langs = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([lang]) => lang);

  const recentRepos = list
    .slice(0, 10)
    .map((r) => ({ name: r.name, description: r.description ?? "" }));

  const summary =
    `Languages: ${langs.join(", ")}\n` +
    `Recent repos:\n${recentRepos.map((r) => `- ${r.name}: ${r.description}`).join("\n")}`;

  return { langs, recentRepos, summary };
}
