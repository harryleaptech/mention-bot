import { spawn } from 'node:child_process';
import { config } from '../config.js';

const describe = (ms) => (ms >= 60_000 ? `${Math.round(ms / 60_000)} min` : `${Math.round(ms / 1000)}s`);

/**
 * Runs the locally logged-in Claude Code (`claude -p`) with `input` on stdin. No API key: it
 * uses the `claude` login on this machine. Resolves to { code, out, err } when it exits, or
 * rejects when it can't start or runs past `timeoutMs`.
 */
export function runClaude({ args, input, cwd, timeoutMs }) {
  const fullArgs = ['-p', ...args];
  if (config.claude.model) fullArgs.push('--model', config.claude.model);

  return new Promise((resolve, reject) => {
    const child = spawn('claude', fullArgs, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`claude timed out after ${describe(timeoutMs)}`));
    }, timeoutMs);

    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, out, err });
    });

    child.stdin.end(input);
  });
}
