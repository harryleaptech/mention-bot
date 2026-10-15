import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// Every setting the bot reads from .env, in one place. Modules import `config` instead of
// reading process.env themselves. Load .env (dotenv) before importing this file.

const number = (value, fallback) => Number(value) || fallback;
const list = (value) =>
  (value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
const fromRoot = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url));

export const config = {
  discord: {
    token: process.env.DISCORD_TOKEN,
    ownerId: process.env.DISCORD_OWNER_ID,
  },
  github: {
    token: process.env.GITHUB_TOKEN,
    pollSeconds: number(process.env.GITHUB_POLL_SECONDS, 60),
  },
  claude: {
    model: process.env.CLAUDE_MODEL || '',
    replyStyle: process.env.REPLY_STYLE || '',
  },
  /** How far back a start looks for mentions sent while the bot was off. */
  catchUpMs: number(process.env.CATCHUP_HOURS, 24) * 60 * 60 * 1000,
  board: {
    port: number(process.env.BOARD_PORT, 4747),
    dirs: list(process.env.BOARD_DIRS).map((d) => resolve(d)),
    taskTimeoutMs: number(process.env.BOARD_TIMEOUT_MINUTES, 30) * 60_000,
  },
  files: {
    seen: fromRoot('state.json'),
    mentions: process.env.MENTIONS_FILE ? resolve(process.env.MENTIONS_FILE) : fromRoot('mentions.json'),
    tasks: process.env.BOARD_FILE ? resolve(process.env.BOARD_FILE) : fromRoot('board.json'),
  },
  designCheck: {
    forumId: process.env.DESIGN_CHECK_FORUM_ID,
    linkChannelId: process.env.DESIGN_CHECK_LINK_CHANNEL_ID,
    mentionId: process.env.DESIGN_CHECK_MENTION_ID,
  },
  /** A path inside the project (views, public, node_modules). */
  root: fromRoot,
};
