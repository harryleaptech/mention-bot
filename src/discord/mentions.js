import { Events } from 'discord.js';
import { config } from '../config.js';
import { clip } from '../lib/text.js';
import { hasSeen } from '../store/seen.js';
import { requestApproval } from './approvals.js';
import { client, OWNER } from './client.js';

/**
 * Offers one Discord message for a reply if it @mentions me. Messages from other bots count
 * (the team works through bots: Jack's Claude, the desk); only this bot's own are skipped.
 */
async function handleMessage(msg) {
  if (msg.author.id === client.user?.id || msg.author.id === OWNER || !msg.inGuild()) return;
  if (!msg.mentions.users.has(OWNER)) return;

  let context = '';
  try {
    const earlier = await msg.channel.messages.fetch({ limit: 8, before: msg.id });
    context = [...earlier.values()]
      .reverse()
      .map((m) => `${m.author.username}: ${clip(m.cleanContent, 400)}`)
      .join('\n');
  } catch {
    // No Read Message History permission: draft without context.
  }

  await requestApproval({
    key: `discord:${msg.id}`,
    source: 'Discord',
    where: `${msg.guild.name} #${msg.channel.name}`,
    author: msg.author.username,
    message: msg.cleanContent,
    context,
    link: msg.url,
    maxLen: 2000,
    target: { kind: 'discord', channelId: msg.channelId, messageId: msg.id },
  }).catch((e) => console.error(`[discord] ${msg.id}: ${e.message}`));
}

client.on(Events.MessageCreate, handleMessage);

/**
 * On start, offers the mentions from the catch-up window that arrived while the bot was off
 * (Discord doesn't replay them). Ones already handled are skipped by requestApproval.
 */
export async function catchUpDiscord() {
  const after = Date.now() - config.catchUpMs;
  const found = [];
  for (const guild of client.guilds.cache.values()) {
    const channels = [...(await guild.channels.fetch()).values()].filter((c) => c?.isTextBased());
    const threads = [...(await guild.channels.fetchActiveThreads()).threads.values()];
    for (const channel of [...channels, ...threads]) {
      try {
        const recent = await channel.messages.fetch({ limit: 100 });
        for (const m of recent.values()) {
          if (m.createdTimestamp >= after && m.mentions.users.has(OWNER) && !hasSeen(`discord:${m.id}`)) {
            found.push(m);
          }
        }
      } catch {
        // No access to this channel.
      }
    }
  }
  found.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  console.log(
    `[discord] catch-up: ${found.length} mention(s) from the last ${config.catchUpMs / 3_600_000}h`,
  );
  for (const m of found) await handleMessage(m);
}
