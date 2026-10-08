const API = 'https://api.github.com';
const LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

// Notification versions already examined in this run, so an unread mention is
// not re-fetched on every poll.
const examined = new Set();

async function gh(url, { method = 'GET', body } = {}) {
  const res = await fetch(url.startsWith('http') ? url : API + url, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'mention-bot',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GitHub ${method} ${url} -> ${res.status} ${text.slice(0, 200)}`);
  }
  return { data: await res.json(), headers: res.headers };
}

export async function getLogin() {
  const { data } = await gh('/user');
  return data.login;
}

function mentions(text, login) {
  return new RegExp(`@${login}(?![A-Za-z0-9-])`, 'i').test(text || '');
}

const clip = (s, n) => (s && s.length > n ? `${s.slice(0, n)}…` : s || '');

/**
 * Returns the unread GitHub mentions as approval items, plus how long GitHub
 * asks us to wait before the next poll. Only issue and pull request threads
 * are handled; the reply always goes as a normal comment on that thread.
 */
export async function fetchMentions(login) {
  const { data: notes, headers } = await gh('/notifications?participating=true&per_page=50');
  const pollSeconds = Number(headers.get('x-poll-interval')) || 60;
  const items = [];

  for (const n of notes) {
    if (n.reason !== 'mention') continue;
    if (!['Issue', 'PullRequest'].includes(n.subject.type)) continue;
    const version = `${n.id}:${n.updated_at}`;
    if (examined.has(version)) continue;
    examined.add(version);

    const issueUrl = n.subject.url.replace('/pulls/', '/issues/');
    const { data: issue } = await gh(issueUrl);
    const since = new Date(Date.parse(n.updated_at) - LOOKBACK_MS).toISOString();
    const { data: comments } = await gh(`${issueUrl}/comments?per_page=100&since=${since}`);

    const me = login.toLowerCase();
    const index = comments.findLastIndex(
      (c) => c.user?.login?.toLowerCase() !== me && mentions(c.body, login),
    );
    const repo = n.repository.full_name;
    const where = `${repo}#${issue.number} — ${issue.title}`;
    const base = {
      source: 'GitHub',
      where,
      maxLen: 4000,
      send: async (text) => {
        const { data } = await gh(`${issueUrl}/comments`, { method: 'POST', body: { body: text } });
        return data.html_url;
      },
    };

    if (index >= 0) {
      const c = comments[index];
      const earlier = comments.slice(Math.max(0, index - 5), index)
        .map((x) => `${x.user?.login}: ${clip(x.body, 600)}`);
      items.push({
        ...base,
        key: `gh:comment:${c.id}`,
        author: `@${c.user.login}`,
        message: c.body,
        link: c.html_url,
        context: [`${issue.user?.login} (opening post): ${clip(issue.body, 1500)}`, ...earlier].join('\n\n'),
      });
    } else if (issue.user?.login?.toLowerCase() !== me && mentions(issue.body, login)) {
      items.push({
        ...base,
        key: `gh:issue:${issue.id}`,
        author: `@${issue.user.login}`,
        message: issue.body,
        link: issue.html_url,
        context: '',
      });
    }
  }

  return { items, pollSeconds };
}
