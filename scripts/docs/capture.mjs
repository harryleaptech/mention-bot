// Makes the README's screenshots and recordings (docs/media/) from a demo board with made-up
// data, never your real mentions or tasks. Needs Google Chrome and ffmpeg.
//
//   npm run docs:media

import { spawn, execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const OUT = here('../../docs/media/');
const PORT = 4790;
const BOARD = `http://127.0.0.1:${PORT}`;

// ---- Demo data --------------------------------------------------------------------------

const ago = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();

function seed(dir, folder) {
  const card = (fields) => ({ dir: folder, createdAt: ago(60), updatedAt: ago(60), ...fields });
  writeJson(join(dir, 'board.json'), {
    cards: [
      card({
        id: 'c1',
        column: 'todo',
        status: 'idle',
        title: 'Write the missing test for the reply length check',
        notes: 'Cover an empty reply, one at the limit and one over it.',
      }),
      card({
        id: 'c2',
        column: 'todo',
        status: 'idle',
        title: 'Rename the settings page heading to "Notifications"',
      }),
      card({
        id: 'c3',
        column: 'doing',
        status: 'failed',
        title: 'Run the full test suite on the release branch',
        error: 'claude timed out after 30 min',
        finishedAt: ago(95),
      }),
      card({
        id: 'c4',
        column: 'done',
        status: 'done',
        title: 'Fix the date format on the invoice page',
        result:
          '**Done.** Dates now show as "15 Oct 2026". Files changed: src/invoice/format.js. Tests: 12/12 passed.',
        finishedAt: ago(240),
        sessionId: 'demo-session-0004',
      }),
    ],
  });
  const mention = (fields) => ({
    status: 'waiting',
    link: 'https://example.com/thread',
    target: { kind: 'demo' },
    context: 'alex: earlier message in the thread',
    ...fields,
  });
  writeJson(join(dir, 'mentions.json'), {
    items: [
      mention({
        id: 'm1',
        key: 'demo-1',
        source: 'GitHub',
        where: 'acme/web#412 — Add a reply length check',
        author: '@alex (PR review)',
        maxLen: 4000,
        createdAt: ago(9),
        message:
          '**Review: looks good.** One small thing: the error message should say the limit. @you can you add that?',
        draft: 'Thanks, good catch. I will add the limit to the message and push a fix today.',
      }),
      mention({
        id: 'm2',
        key: 'demo-2',
        source: 'Discord',
        where: 'Acme #frontend',
        author: 'jordan',
        maxLen: 2000,
        createdAt: ago(120),
        message: '@you could you take a look at the flaky login test when you have a minute?',
        draft: 'Sure, I will look at it this afternoon.',
      }),
    ],
  });
}

const writeJson = (path, data) => writeFileSync(path, JSON.stringify(data, null, 2));

// ---- The demo board ---------------------------------------------------------------------

function startDemo() {
  const temp = mkdtempSync(join(tmpdir(), 'board-demo-'));
  const folder = join(temp, 'acme-web');
  const bin = join(temp, 'bin');
  mkdirSync(folder);
  mkdirSync(bin);
  copyFileSync(here('./fake-claude.sh'), join(bin, 'claude'));
  chmodSync(join(bin, 'claude'), 0o755);
  seed(temp, folder);

  const server = spawn(process.execPath, [here('./demo-server.mjs')], {
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      BOARD_PORT: String(PORT),
      BOARD_DIRS: folder,
      BOARD_FILE: join(temp, 'board.json'),
      MENTIONS_FILE: join(temp, 'mentions.json'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr.on('data', (d) => process.stderr.write(`[demo] ${d}`));
  return new Promise((resolve, reject) => {
    server.stdout.on('data', (d) => {
      if (String(d).includes('[board]')) resolve({ server, temp });
    });
    server.on('exit', (code) => reject(new Error(`demo board stopped (${code})`)));
  });
}

// ---- Capturing --------------------------------------------------------------------------

const browser = await chromium.launch({ channel: 'chrome' });

async function page({ theme = 'govuk', width = 1440, height = 900 } = {}) {
  const context = await browser.newContext({ viewport: { width, height } });
  await context.addInitScript((t) => localStorage.setItem('board-theme', t), theme);
  const p = await context.newPage();
  return { p, context };
}

const open = async (p, path) => {
  await p.goto(BOARD + path);
  await p.waitForLoadState('load');
  await p.waitForTimeout(500);
};

async function screenshot(name, path, options = {}) {
  const { p, context } = await page(options);
  await open(p, path);
  if (options.before) await options.before(p);
  await p.screenshot({ path: join(OUT, `${name}.png`), clip: options.clip });
  await context.close();
  console.log(`  ${name}.png`);
}

/**
 * Records `steps` as a GIF with Chrome's screencast (frames with timestamps, through page
 * loads), joined by ffmpeg at the real pace. No Playwright video download needed.
 */
async function recording(name, steps, options = {}) {
  const { p, context } = await page({ ...options, width: 1280, height: 800 });
  const frames = join(OUT, '.frames');
  rmSync(frames, { recursive: true, force: true });
  mkdirSync(frames, { recursive: true });

  const shots = [];
  const cdp = await context.newCDPSession(p);
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    const file = join(frames, `${String(shots.length + 1).padStart(5, '0')}.jpg`);
    writeFileSync(file, Buffer.from(data, 'base64'));
    shots.push({ file, at: metadata.timestamp, size: `${metadata.deviceWidth}x${metadata.deviceHeight}` });
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: 1280, maxHeight: 800 });

  await steps(p);
  await p.waitForTimeout(1200);
  await cdp.send('Page.stopScreencast');
  await context.close();

  // Frames from before the window settled have another size, which ffmpeg can't mix: keep
  // only the frames at the final size.
  const finalSize = shots.at(-1).size;
  const kept = shots.filter((s) => s.size === finalSize);
  shots.length = 0;
  shots.push(...kept);

  // Each frame stays on screen until the next one (the screencast only sends changes).
  const end = Date.now() / 1000;
  const list = shots
    .map((s, i) => `file '${s.file}'\nduration ${((shots[i + 1]?.at ?? end) - s.at).toFixed(3)}`)
    .join('\n');
  const listFile = join(frames, 'frames.txt');
  writeFileSync(listFile, `${list}\nfile '${shots.at(-1).file}'\n`);

  const input = ['-f', 'concat', '-safe', '0', '-i', listFile];
  const palette = join(frames, 'palette.png');
  const scale = 'fps=10,scale=960:-1:flags=lanczos';
  ffmpeg([...input, '-vf', `${scale},palettegen=stats_mode=diff`, palette]);
  ffmpeg([
    ...input,
    '-i',
    palette,
    '-lavfi',
    `${scale} [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=4`,
    join(OUT, `${name}.gif`),
  ]);
  rmSync(frames, { recursive: true, force: true });
  console.log(`  ${name}.gif (${shots.length} frames)`);
}

const ffmpeg = (args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args]);

const pause = (p, ms = 900) => p.waitForTimeout(ms);
const slowType = (p, selector, text) => p.locator(selector).pressSequentially(text, { delay: 35 });

let demo = await startDemo();
// Whatever happens, don't leave the demo board running.
process.on('exit', () => demo.server.kill());
process.on('uncaughtException', (e) => {
  console.error(e);
  process.exit(1);
});
const restartDemo = async () => {
  // Wait for the old one to exit so the new one can take the port.
  await new Promise((resolve) => {
    demo.server.once('exit', resolve);
    demo.server.kill();
  });
  rmSync(demo.temp, { recursive: true, force: true });
  demo = await startDemo();
};

console.log('Screenshots:');
await screenshot('board-govuk', '/');
await screenshot('board-modern', '/', { theme: 'modern' });
await screenshot('board-dark', '/', { theme: 'dark' });
await screenshot('add-task', '/tasks/new', { theme: 'modern' });
await screenshot('task-page', '/tasks/c4', { theme: 'modern' });
await screenshot('mention-reply', '/mentions/m1', { theme: 'modern' });
await screenshot('delete-task', '/tasks/c2/delete', { theme: 'modern' });
await screenshot('phone', '/', { theme: 'modern', width: 390, height: 844 });
await screenshot('manual-mode', '/', {
  theme: 'modern',
  clip: { x: 0, y: 0, width: 1440, height: 520 },
  before: async (p) => {
    await p.check('#mode-manual');
    process.kill(demo.server.pid, 'SIGUSR2');
    await p.locator('#board-pending').waitFor({ state: 'visible' });
  },
});
await restartDemo();

console.log('Recordings:');
await recording(
  'run-a-task',
  async (p) => {
    await open(p, '/');
    await pause(p);
    await p.getByRole('button', { name: 'Add a task' }).click();
    await pause(p, 600);
    await slowType(p, '#title', 'Add a test for the reply length check');
    await slowType(p, '#notes', 'Cover an empty reply, one at the limit and one over it.');
    await pause(p, 500);
    await p.getByRole('button', { name: 'Add and start' }).click();
    await p.locator('.board-card--done', { hasText: 'Add a test for the reply length check' }).waitFor();
    await pause(p, 1500);
  },
  { theme: 'modern' },
);

await recording(
  'reply-to-mention',
  async (p) => {
    await open(p, '/');
    await pause(p);
    await p.locator('.board-card--github').getByRole('link', { name: /Edit/ }).click();
    await pause(p, 900);
    await p.locator('#reply').click();
    await p.keyboard.press('End');
    await slowType(p, '#reply', ' The fix is in #415.');
    await pause(p, 600);
    await p.getByRole('button', { name: 'Send reply' }).click();
    await pause(p, 3800); // the "Reply sent" notice fades after 3 seconds
  },
  { theme: 'modern' },
);
await restartDemo();

await recording(
  'live-updates',
  async (p) => {
    await open(p, '/');
    await pause(p, 1200);
    process.kill(demo.server.pid, 'SIGUSR2'); // a mention arrives: it appears by itself
    await pause(p, 2200);
    await p.check('#mode-manual');
    await pause(p, 800);
    process.kill(demo.server.pid, 'SIGUSR2'); // in Manual, the board waits
    await pause(p, 1800);
    await p.getByRole('button', { name: 'Refresh' }).click();
    await pause(p, 1500);
    await p.check('#mode-live');
  },
  { theme: 'modern' },
);

await browser.close();
demo.server.kill();
rmSync(demo.temp, { recursive: true, force: true });
console.log(`Done: ${readdirSync(OUT).length} files in docs/media/`);
