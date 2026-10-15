import 'dotenv/config';
import { Events } from 'discord.js';

// Start-up: check the settings, then start Discord, GitHub and the task board.

for (const name of ['DISCORD_TOKEN', 'DISCORD_OWNER_ID']) {
  if (!process.env[name]) {
    console.error(`Missing ${name}. Copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
}

// Imported after the check: these modules read the settings when they load.
const { config } = await import('./config.js');
const { client } = await import('./discord/client.js');
const { notifyTask, requestApproval } = await import('./discord/approvals.js');
const { catchUpDiscord } = await import('./discord/mentions.js');
const { watchGitHub } = await import('./github/mentions.js');
const { onTaskFinished } = await import('./board/runner.js');
const { startBoard } = await import('./board/server.js');

onTaskFinished(notifyTask);
startBoard();

client.once(Events.ClientReady, (c) => {
  console.log(`[discord] logged in as ${c.user.tag}, in ${c.guilds.cache.size} server(s)`);
  watchGitHub(requestApproval).catch((e) => console.error(`[github] ${e.message}`));
  catchUpDiscord().catch((e) => console.error(`[discord] catch-up: ${e.message}`));
});

await client.login(config.discord.token);
