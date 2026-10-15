import 'dotenv/config';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { config } from '../config.js';
import { hasSeen, markSeen } from '../store/seen.js';

// Posts a design preview (ADR-065) as one forum post, then puts its link in
// the team channel. Without --post it only prints what it would send.

const API = 'https://discord.com/api/v10';
const MESSAGE_MAX = 2000;
const TITLE_MAX = 100;
const FILES_MAX = 10;
const FILE_BYTES_MAX = 10 * 1024 * 1024;
const WAITING_TAG = 'waiting review';
const MEDIA = /[\w][\w.()-]*\.(?:png|jpe?g|gif|webp|mp4|mov)/gi;

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const file = args.find((a) => !a.startsWith('--'));

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!file) fail('Usage: npm run design-check -- <preview.md> [--post] [--again]');
for (const name of ['DISCORD_TOKEN', 'DESIGN_CHECK_FORUM_ID', 'DESIGN_CHECK_LINK_CHANNEL_ID']) {
  if (!process.env[name]) fail(`Missing ${name} in .env.`);
}

const FORUM = config.designCheck.forumId;
const LINK_CHANNEL = config.designCheck.linkChannelId;
const MENTION = config.designCheck.mentionId;

async function discord(path, { payload, files = [] } = {}) {
  const headers = { Authorization: `Bot ${config.discord.token}` };
  let body;
  if (files.length) {
    body = new FormData();
    body.append('payload_json', JSON.stringify(payload));
    files.forEach((f, i) => body.append(`files[${i}]`, new Blob([readFileSync(f)]), basename(f)));
  } else if (payload) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(payload);
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(API + path, { method: payload ? 'POST' : 'GET', headers, body });
    if (res.status === 429) {
      const { retry_after: wait = 1 } = await res.json().catch(() => ({}));
      await new Promise((r) => setTimeout(r, (wait + 0.2) * 1000));
      continue;
    }
    if (!res.ok) throw new Error(`Discord ${path} -> ${res.status} ${(await res.text()).slice(0, 300)}`);
    return res.json();
  }
  throw new Error(`Discord ${path} -> still rate limited`);
}

/** Splits one section into messages of at most MESSAGE_MAX, at blank lines. */
function splitLong(text) {
  if (text.length <= MESSAGE_MAX) return [text];
  const out = [];
  let current = '';
  for (const para of text.split(/\n{2,}/)) {
    if (para.length > MESSAGE_MAX)
      fail(
        `One paragraph is over ${MESSAGE_MAX} characters. Add a blank line inside it:\n${para.slice(0, 120)}…`,
      );
    if (current && current.length + para.length + 2 > MESSAGE_MAX) {
      out.push(current);
      current = para;
    } else {
      current = current ? `${current}\n\n${para}` : para;
    }
  }
  if (current) out.push(current);
  return out;
}

function parse(path) {
  const folder = dirname(path);
  const lines = readFileSync(path, 'utf8').replace(/\r\n/g, '\n').split('\n');
  const titleAt = lines.findIndex((l) => l.startsWith('# '));
  if (titleAt < 0) fail('The preview needs a first line like "# <EPIC/story> · <screen or feature>".');
  const title = lines[titleAt].slice(2).trim();
  if (title.length > TITLE_MAX) fail(`The title is ${title.length} characters; Discord allows ${TITLE_MAX}.`);

  const rest = lines.slice(titleAt + 1);
  const lineAt = rest.findIndex((l) => /^line:/i.test(l));
  const linkLine =
    lineAt >= 0
      ? rest
          .splice(lineAt, 1)[0]
          .replace(/^line:/i, '')
          .trim()
      : title;

  // One message per "## " section; text above the first section goes with it.
  const sections = rest
    .join('\n')
    .split(/\n(?=## )/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sections.length > 1 && !sections[0].startsWith('## ')) {
    sections.splice(0, 2, `${sections[0]}\n\n${sections[1]}`);
  }

  const messages = [];
  for (const section of sections) {
    for (const content of splitLong(section)) {
      const names = [...new Set(content.match(MEDIA) || [])];
      const files = names.map((n) => join(folder, n)).filter((f) => existsSync(f));
      if (files.length > FILES_MAX)
        fail(`A message has ${files.length} files; Discord allows ${FILES_MAX}. Split the section.`);
      for (const f of files) {
        if (statSync(f).size > FILE_BYTES_MAX) fail(`${basename(f)} is over 10 MB.`);
      }
      const missing = names.filter((n) => !existsSync(join(folder, n)));
      messages.push({ content, files, missing });
    }
  }
  if (!messages.length) fail('The preview has no text under the title.');
  return { title, linkLine, messages };
}

const mention = (text) => (MENTION ? text.replace(/@D\b/g, `<@${MENTION}>`) : text);
const allowed = { parse: [], users: MENTION ? [MENTION] : [] };

function payloadOf(message) {
  return {
    content: mention(message.content),
    allowed_mentions: allowed,
    attachments: message.files.map((f, id) => ({ id, filename: basename(f) })),
  };
}

const path = resolve(file);
if (!existsSync(path)) fail(`File not found: ${path}`);
const preview = parse(path);
const key = `design-check:${preview.title}`;

console.log(`Forum post title: ${preview.title}`);
preview.messages.forEach((m, i) => {
  console.log(
    `\n--- message ${i + 1} of ${preview.messages.length} (${m.content.length} characters, ${m.files.length} file(s))`,
  );
  console.log(m.content);
  if (m.files.length) console.log(`[attached: ${m.files.map((f) => basename(f)).join(', ')}]`);
  if (m.missing.length)
    console.log(`[NOT FOUND next to the preview, so not attached: ${m.missing.join(', ')}]`);
});
console.log(`\n--- line for the team channel\n${preview.linkLine}: <link to the post>`);
if (!MENTION && /@D\b/.test(preview.messages[0].content)) {
  console.log('\nNote: DESIGN_CHECK_MENTION_ID is empty, so "@D" stays plain text and pings nobody.');
}

if (!flags.has('--post')) {
  console.log('\nDry run: nothing was posted. Add --post to post it.');
  process.exit(0);
}
if (hasSeen(key) && !flags.has('--again')) {
  fail(
    '\nThis title was already posted. A new version goes inside the existing post; use --again only for a new post.',
  );
}

const forum = await discord(`/channels/${FORUM}`);
const tag = (forum.available_tags || []).find((t) => t.name.toLowerCase() === WAITING_TAG);
const [first, ...others] = preview.messages;

const thread = await discord(`/channels/${FORUM}/threads`, {
  payload: { name: preview.title, applied_tags: tag ? [tag.id] : [], message: payloadOf(first) },
  files: first.files,
});
const url = `https://discord.com/channels/${forum.guild_id}/${thread.id}`;
markSeen(key);
console.log(`\nPosted: ${url}`);

for (const message of others) {
  await discord(`/channels/${thread.id}/messages`, { payload: payloadOf(message), files: message.files });
}

try {
  await discord(`/channels/${LINK_CHANNEL}/messages`, {
    payload: { content: `${preview.linkLine}: ${url}`, allowed_mentions: { parse: [] } },
  });
  console.log('Link posted in the team channel.');
} catch (e) {
  console.error(
    `The forum post is up, but the link line failed (${e.message}). Paste this yourself:\n${preview.linkLine}: ${url}`,
  );
  process.exit(1);
}
