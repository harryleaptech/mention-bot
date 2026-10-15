import { config } from '../config.js';
import { runClaude } from './cli.js';

// Board tasks are mine (only the board page can create them), so Claude may read and edit
// files in the chosen folder. Everything that leaves this Mac stays blocked: a task ends as
// local changes and a summary, and I push or post myself.

const ALLOWED = [
  'Read',
  'Grep',
  'Glob',
  'Edit',
  'Write',
  'TodoWrite',
  'Bash(git status:*)',
  'Bash(git diff:*)',
  'Bash(git log:*)',
  'Bash(git show:*)',
  'Bash(git add:*)',
  'Bash(git commit:*)',
  'Bash(gh pr view:*)',
  'Bash(gh pr list:*)',
  'Bash(gh pr checks:*)',
  'Bash(gh pr diff:*)',
  'Bash(gh issue view:*)',
  'Bash(gh issue list:*)',
  'Bash(gh search:*)',
  'Bash(ls:*)',
  'Bash(cat:*)',
  'Bash(grep:*)',
  'Bash(wc:*)',
  'Bash(php vendor/bin/phpunit:*)',
  'Bash(php -l:*)',
  'Bash(npx vitest:*)',
];

const BLOCKED = [
  'Bash(git push:*)',
  'Bash(git remote:*)',
  'Bash(gh api:*)',
  'Bash(gh pr create:*)',
  'Bash(gh pr merge:*)',
  'Bash(gh pr comment:*)',
  'Bash(gh pr review:*)',
  'Bash(gh pr edit:*)',
  'Bash(gh issue create:*)',
  'Bash(gh issue comment:*)',
  'Bash(gh issue edit:*)',
  'Bash(curl:*)',
  'Bash(rm:*)',
  'WebFetch',
];

const INSTRUCTIONS = [
  'This task comes from my task board and runs unattended: nobody can answer a question mid-run.',
  'Work in the current folder. Never push, never post or comment anywhere, never open or merge a PR;',
  'leave the work as local changes (a local commit is fine) for me to check.',
  'If the task is unclear or needs a decision only I can make, stop and say what you need.',
  'End with a short summary: what you did, files changed, tests run and their result, anything left for me.',
].join(' ');

/**
 * Runs one board task in `cwd`. Resolves to { result, sessionId }; the session is kept, so
 * `claude --resume <sessionId>` continues it in a terminal.
 */
export async function runTask({ title, notes, cwd }) {
  const prompt = [`Task: ${title}`, notes ? `Details:\n${notes}` : ''].filter(Boolean).join('\n\n');
  const { code, out, err } = await runClaude({
    args: [
      '--output-format',
      'json',
      '--permission-mode',
      'acceptEdits',
      '--allowedTools',
      ...ALLOWED,
      '--disallowedTools',
      ...BLOCKED,
      '--append-system-prompt',
      INSTRUCTIONS,
    ],
    input: prompt,
    cwd,
    timeoutMs: config.board.taskTimeoutMs,
  });

  let result;
  try {
    result = JSON.parse(out);
  } catch {
    throw new Error(`claude exited ${code}: ${(err || out).trim().slice(0, 300)}`);
  }
  if (result.is_error) {
    const message = String(result.result || 'claude reported an error').slice(0, 500);
    throw Object.assign(new Error(message), { sessionId: result.session_id });
  }
  return { result: String(result.result || '').trim(), sessionId: result.session_id };
}
