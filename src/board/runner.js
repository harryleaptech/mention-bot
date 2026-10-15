import { runTask } from '../claude/tasks.js';
import { cards, isBusy, saveTasks } from '../store/tasks.js';

// Runs board tasks with Claude Code, one at a time; the rest wait their turn. When a run ends
// the card moves to Done (or stays in Doing, failed) and onTaskFinished hears about it.

const MAX_RUNS = 1;
let running = 0;

let notify = async () => {};
/** Called with the card when a run finishes, to DM me. */
export const onTaskFinished = (fn) => {
  notify = fn;
};

function startNext() {
  if (running >= MAX_RUNS) return;
  const card = cards().find((c) => c.status === 'waiting');
  if (!card) return;

  running += 1;
  card.status = 'running';
  card.startedAt = new Date().toISOString();
  saveTasks();
  console.log(`[board] running "${card.title}" in ${card.dir}`);

  runTask({ title: card.title, notes: card.notes, cwd: card.dir })
    .then(({ result, sessionId }) => {
      Object.assign(card, { status: 'done', column: 'done', result, sessionId });
    })
    .catch((e) => {
      Object.assign(card, { status: 'failed', error: e.message, sessionId: e.sessionId || card.sessionId });
    })
    .finally(() => {
      running -= 1;
      card.finishedAt = new Date().toISOString();
      card.updatedAt = card.finishedAt;
      saveTasks();
      console.log(`[board] ${card.status} "${card.title}"`);
      notify(card).catch((e) => console.error(`[board] DM failed: ${e.message}`));
      startNext();
    });
}

/** Sends a task to Doing and queues its run (also "run again" after a failure). */
export function startCard(card) {
  if (isBusy(card)) return;
  Object.assign(card, {
    column: 'doing',
    status: 'waiting',
    result: undefined,
    error: undefined,
    finishedAt: undefined,
    updatedAt: new Date().toISOString(),
  });
  saveTasks();
  startNext();
}

/** Picks up any task left waiting (on start). */
export const resumeQueue = startNext;
