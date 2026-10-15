import { waitingMentions } from '../store/mentions.js';
import { cards, folders, isBusy } from '../store/tasks.js';

// What the templates show for a task or a mention, and the four columns.

const STATUS_TAG = {
  idle: { text: 'To do', classes: 'govuk-tag--grey' },
  waiting: { text: 'Waiting', classes: 'govuk-tag--blue' },
  running: { text: 'Running', classes: 'govuk-tag--yellow' },
  done: { text: 'Done', classes: 'govuk-tag--green' },
  failed: { text: 'Failed', classes: 'govuk-tag--red' },
};
const CLOSED_TAG = { text: 'Closed', classes: 'govuk-tag--grey' };

/** The green banner after an action (?notice=…). */
export const NOTICES = {
  added: 'Task added to To do',
  started: 'Task started. You get a DM when it finishes.',
  todo: 'Task moved back to To do',
  done: 'Task moved to Done',
  deleted: 'Task deleted',
  sent: 'Reply sent',
  skipped: 'Mention skipped. Nothing was sent.',
  saved: 'Draft saved',
  tasked: 'Mention made into a task in To do. Nothing was sent.',
};

export function taskView(card) {
  const folder = folders().find((f) => f.path === card.dir);
  // A card moved to Done without a successful run is "Closed", not "Done".
  const tag =
    card.column === 'done' && card.status !== 'done'
      ? CLOSED_TAG
      : STATUS_TAG[card.status] || STATUS_TAG.idle;
  return {
    ...card,
    folderName: folder ? folder.name : card.dir,
    tag,
    busy: isBusy(card),
    resume: card.sessionId ? `cd ${card.dir} && claude --resume ${card.sessionId}` : '',
  };
}

export const mentionView = (mention) => ({ ...mention, title: `${mention.author} on ${mention.source}` });

export function columns() {
  const all = cards().map(taskView);
  return [
    { id: 'mentions', title: 'Mentions', mentions: waitingMentions().map(mentionView).reverse() },
    { id: 'todo', title: 'To do', cards: all.filter((c) => c.column === 'todo') },
    { id: 'doing', title: 'Doing', cards: all.filter((c) => c.column === 'doing') },
    { id: 'done', title: 'Done', cards: all.filter((c) => c.column === 'done').reverse() },
  ];
}
