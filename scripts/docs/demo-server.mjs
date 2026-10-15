// A demo task board for the README's screenshots and recordings: made-up mentions and tasks,
// replies that go nowhere, and the fake `claude` (fake-claude.sh) on PATH. Started by
// capture.mjs with BOARD_PORT, BOARD_DIRS, BOARD_FILE and MENTIONS_FILE set to a temp folder.
// `kill -USR2 <pid>` adds a new mention, to show live updates.

const { registerSender, addMention } = await import('../../src/store/mentions.js');
const { onTaskFinished } = await import('../../src/board/runner.js');
const { startBoard } = await import('../../src/board/server.js');

registerSender('demo', async () => 'https://example.com/reply');
onTaskFinished(async () => {});

let n = 0;
process.on('SIGUSR2', () => {
  n += 1;
  addMention({
    key: `demo-live-${n}`,
    source: 'Discord',
    where: 'Acme #frontend',
    author: n === 1 ? 'sam' : 'priya',
    message:
      n === 1 ? '@you is the release still on for Friday?' : '@you the staging build is green, ok to merge?',
    link: 'https://example.com/live',
    maxLen: 2000,
    target: { kind: 'demo' },
    draft: n === 1 ? 'Yes, Friday as planned.' : 'Yes, go ahead and merge.',
  });
});

startBoard();
