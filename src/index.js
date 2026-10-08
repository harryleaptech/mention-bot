import 'dotenv/config';
import { Events } from 'discord.js';

for (const name of ['DISCORD_TOKEN', 'DISCORD_OWNER_ID']) {
  if (!process.env[name]) {
    console.error(`Missing ${name}. Copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
}

// Imported after the env check because these modules read process.env on load.
const { client, requestApproval } = await import('./discord.js');
const { fetchMentions, getLogin } = await import('./github.js');

async function watchGitHub() {
  if (!process.env.GITHUB_TOKEN) {
    console.log('[github] GITHUB_TOKEN is empty: GitHub mentions are off.');
    return;
  }
  const login = await getLogin();
  console.log(`[github] watching mentions of @${login}`);
  const minimum = Number(process.env.GITHUB_POLL_SECONDS) || 60;

  const tick = async () => {
    let wait = minimum;
    try {
      const { items, pollSeconds } = await fetchMentions(login);
      wait = Math.max(minimum, pollSeconds);
      for (const item of items) await requestApproval(item);
    } catch (e) {
      console.error(`[github] ${e.message}`);
    }
    setTimeout(tick, wait * 1000);
  };
  tick();
}

client.once(Events.ClientReady, (c) => {
  console.log(`[discord] logged in as ${c.user.tag}, in ${c.guilds.cache.size} server(s)`);
  watchGitHub().catch((e) => console.error(`[github] ${e.message}`));
});

await client.login(process.env.DISCORD_TOKEN);
