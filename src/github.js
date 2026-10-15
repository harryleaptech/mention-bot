import { registerSender } from './mentions.js';

const API = 'https://api.github.com';
const LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
// On start, look back this far so a restart never loses a mention (handled ones are in state.json).
const CATCHUP_MS = (Number(process.env.CATCHUP_HOURS) || 24) * 60 * 60 * 1000;
const STARTED = new Date(Date.now() - CATCHUP_MS).toISOString();

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
 * asks us to wait before the next poll. Issue and pull request threads: comments,
 * the opening post, and pull request review texts. The reply always goes as a
 * normal comment on that thread.
 */
export async function fetchMentions(login) {
  const { data: unread, headers } = await gh('/notifications?participating=true&per_page=50');
  const pollSeconds = Number(headers.get('x-poll-interval')) || 60;
  // Opening a thread on GitHub marks it read, which drops it from the unread
  // list before the next poll. So also take read ones updated since the
  // catch-up window before startup.
  const { data: recent } = await gh(`/notifications?participating=true&all=true&per_page=50&since=${STARTED}`);
  const notes = [...new Map([...unread, ...recent].map((n) => [n.id, n])).values()];
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
    // A review's text mentions me too (round-by-round PR reviews); it is not a comment.
    let reviews = [];
    if (n.subject.type === 'PullRequest') {
      ({ data: reviews } = await gh(`${n.subject.url}/reviews?per_page=100`));
    }
    const thread = [
      ...comments.map((c) => ({ kind: 'comment', id: c.id, user: c.user, body: c.body, url: c.html_url, at: c.created_at })),
      ...reviews.filter((r) => r.body && r.submitted_at >= since)
        .map((r) => ({ kind: 'review', id: r.id, user: r.user, body: r.body, url: r.html_url, at: r.submitted_at })),
    ].sort((a, b) => a.at.localeCompare(b.at));
    const mine = (x) => x.user?.login?.toLowerCase() === me;
    const mentioning = thread.filter((x) => !mine(x) && mentions(x.body, login));

    const repo = n.repository.full_name;
    const where = `${repo}#${issue.number} — ${issue.title}`;
    const base = {
      source: 'GitHub',
      where,
      maxLen: 4000,
      target: { kind: 'github', commentsUrl: `${issueUrl}/comments` },
    };

    // Every mention in the catch-up window (already-handled ones are skipped by the caller),
    // or at least the newest one.
    const offer = mentioning.filter((x) => x.at >= STARTED);
    if (!offer.length && mentioning.length) offer.push(mentioning[mentioning.length - 1]);

    for (const x of offer) {
      const index = thread.indexOf(x);
      const earlier = thread.slice(Math.max(0, index - 5), index)
        .map((y) => `${y.user?.login}: ${clip(y.body, 600)}`);
      items.push({
        ...base,
        key: `gh:${x.kind}:${x.id}`,
        author: `@${x.user.login}${x.kind === 'review' ? ' (PR review)' : ''}`,
        message: x.body,
        link: x.url,
        context: [`${issue.user?.login} (opening post): ${clip(issue.body, 1500)}`, ...earlier].join('\n\n'),
      });
    }
    if (!mentioning.length && !mine(issue) && mentions(issue.body, login)) {
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

// A reply goes as a normal comment on the issue or pull request thread.
registerSender('github', async (target, text) => {
  const { data } = await gh(target.commentsUrl, { method: 'POST', body: { body: text } });
  return data.html_url;
});
