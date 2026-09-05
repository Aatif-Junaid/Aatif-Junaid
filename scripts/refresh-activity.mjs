import { mkdir, writeFile } from 'node:fs/promises';

// Public data only. No dependency on a personal access token or hosted card service.
const owner = 'Aatif-Junaid';
const day = 86400000;
const until = new Date();
const end = new Date(Date.UTC(until.getUTCFullYear(), until.getUTCMonth(), until.getUTCDate() + 1));
const start = new Date(end - 84 * day);
const isoDay = date => date.toISOString().slice(0, 10);

async function api(path) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'Aatif-public-builder-activity', 'X-GitHub-Api-Version': '2022-11-28' };
  if (process.env.GH_TOKEN) headers.Authorization = `Bearer ${process.env.GH_TOKEN}`;
  let response = await fetch(`https://api.github.com${path}`, { headers, signal: AbortSignal.timeout(30000) });
  // Installation tokens can be narrower than the public API. Retry publicly.
  if ([403, 404].includes(response.status) && headers.Authorization) {
    delete headers.Authorization;
    response = await fetch(`https://api.github.com${path}`, { headers, signal: AbortSignal.timeout(30000) });
  }
  if (!response.ok) throw new Error(`GitHub ${response.status}: ${path}`);
  return response.json();
}

async function pages(path) {
  const rows = [];
  for (let page = 1; page <= 100; page++) {
    const batch = await api(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    if (!Array.isArray(batch)) throw new Error('Expected a paginated array');
    rows.push(...batch);
    if (batch.length < 100) return rows;
  }
  throw new Error('Pagination limit reached; refusing a partial count');
}

const repos = (await pages(`/users/${owner}/repos?type=owner`))
  .filter(repo => !repo.private && !repo.fork && repo.owner.login.toLowerCase() === owner.toLowerCase());
const commits = new Map();
for (const repo of repos) {
  if (repo.size === 0) continue;
  const rows = await pages(`/repos/${owner}/${repo.name}/commits?author=${owner}&since=${start.toISOString()}&until=${until.toISOString()}`);
  for (const row of rows) {
    if (row.author?.login?.toLowerCase() !== owner.toLowerCase()) continue;
    const date = row.commit.committer.date;
    if (new Date(date) < start || new Date(date) > until) continue;
    commits.set(row.sha, { sha: row.sha, date, repository: repo.name, url: row.html_url });
  }
}
const entries = [...commits.values()].sort((a, b) => a.date.localeCompare(b.date));
const activeDays = new Set(entries.map(commit => commit.date.slice(0, 10))).size;
const weeks = Array.from({ length: 12 }, (_, i) => ({ start: isoDay(new Date(+start + i * 7 * day)), commits: 0 }));
for (const commit of entries) weeks[Math.floor((new Date(commit.date) - start) / (7 * day))].commits++;
if (weeks.reduce((sum, week) => sum + week.commits, 0) !== entries.length) throw new Error('Weekly totals do not reconcile');

const data = {
  generatedAt: until.toISOString(),
  window: { from: start.toISOString(), through: until.toISOString(), calendarDays: 84 },
  methodology: 'Unique commits authored by Aatif-Junaid on default branches of owned, public, non-fork repositories. Grouped by UTC committer date. Excludes private repositories, other branches, forks, and bot-authored commits. Active days are UTC dates with at least one included commit. Not GitHub contribution totals.',
  publicRepositories: repos.map(repo => ({ name: repo.name, url: repo.html_url })),
  authoredCommits: entries.length, activeDays, weeks, commits: entries,
};

const max = Math.max(1, ...weeks.map(week => week.commits));
const bars = weeks.map((week, index) => {
  const height = week.commits ? Math.max(3, week.commits / max * 48) : 1;
  return `<rect x="${360 + index * 24}" y="${112 - height}" width="15" height="${height}" rx="2" fill="${index === 11 ? '#58bde4' : '#2f7fb3'}"><title>Week starting ${week.start}: ${week.commits} commits</title></rect>`;
}).join('');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="680" height="172" viewBox="0 0 680 172" role="img" aria-labelledby="title description">
<title id="title">Building in public</title>
<desc id="description">${entries.length} authored commits on ${activeDays} active days in the last 12 weeks across ${repos.length} owned public repositories. Updated ${isoDay(until)}. Weekly counts: ${weeks.map(w => w.commits).join(', ')}.</desc>
<style>text{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif;fill:#26241f}.muted{fill:#6b655b}.number{font-size:36px;font-weight:650}.small{font-size:11px}@media(prefers-color-scheme:dark){text{fill:#eeeDE8}.muted{fill:#b9b7b0}}</style>
<rect x=".5" y=".5" width="679" height="171" rx="12" fill="none" stroke="#2f7fb3" stroke-opacity=".4"/>
<text x="22" y="28" font-size="15" font-weight="650">Building in public</text>
<text x="658" y="28" text-anchor="end" class="muted small">LAST 12 WEEKS · ${isoDay(until)}</text>
<text x="22" y="85" class="number">${entries.length}</text><text x="22" y="109" class="muted" font-size="13">authored commits</text>
<text x="200" y="85" class="number">${activeDays}</text><text x="200" y="109" class="muted" font-size="13">active days</text>
${bars}<text x="360" y="130" class="muted small">${isoDay(start)}</text><text x="639" y="130" text-anchor="end" class="muted small">now</text>
<text x="22" y="155" class="muted small">${repos.length} owned public repos · default branches · excludes private builds · refreshed daily</text>
</svg>\n`;
await mkdir('profile', { recursive: true });
// Write only after all API calls and validation pass; errors retain last good card.
await writeFile('profile/activity.json', JSON.stringify(data, null, 2) + '\n');
await writeFile('profile/activity.svg', svg);
console.log(JSON.stringify({ authoredCommits: entries.length, activeDays, repositories: repos.length, weeks }));
