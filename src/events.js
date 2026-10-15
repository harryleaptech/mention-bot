import { EventEmitter } from 'node:events';

// One signal for "the board's data changed" (a mention arrived or was decided, a task moved or
// finished). The board's open pages listen through /events and update at once.
export const changes = new EventEmitter();
changes.setMaxListeners(50);

export const changed = () => changes.emit('change');
