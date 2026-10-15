import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, Client, EmbedBuilder, Events,
  GatewayIntentBits, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { draftReply } from './claude.js';
import { hasSeen, markSeen } from './state.js';
import {
  addMention, closeMention, findMention, onDecided, registerSender, sendMention, updateMention,
} from './mentions.js';

const OWNER = process.env.DISCORD_OWNER_ID;
const MODAL_MAX = 4000; // Discord's limit for a modal text field

// Mentions are kept in mentions.js (shared with the task board), so a DM's buttons still
// work after a restart, and deciding on the board closes the DM.
const inFlight = new Set();

export const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const clip = (s, n) => (s && s.length > n ? `${s.slice(0, n)}…` : s || '');

const STATUS_TEXT = {
  sent: 'Sent',
  skipped: 'Skipped — nothing sent',
  task: 'Made into a task on the board — nothing sent',
};

function render(item, status) {
  const mention = new EmbedBuilder()
    .setTitle(`${item.source} mention`)
    .setURL(item.link)
    .setDescription(clip(item.message, 1200) || '(no text)')
    .setFooter({ text: clip(`${item.author} · ${item.where}`, 200) });
  const draft = new EmbedBuilder()
    .setTitle(status || 'Draft reply — not sent yet')
    .setDescription(clip(item.draft, 4000) || '(empty — press Edit to write one)');
  if (item.error) draft.setFooter({ text: clip(`Draft failed: ${item.error}`, 300) });
  return [mention, draft];
}

function buttons(id) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`send:${id}`).setLabel('Send').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`edit:${id}`).setLabel('Edit').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`skip:${id}`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
  )];
}

/**
 * Drafts a reply for one mention, keeps it for the board, and DMs it to the owner with
 * Send / Edit / Skip. Nothing is posted anywhere until the owner presses Send.
 */
export async function requestApproval(item) {
  if (inFlight.has(item.key) || hasSeen(item.key)) return;
  inFlight.add(item.key);
  try {
    try {
      item.draft = await draftReply({ ...item, style: process.env.REPLY_STYLE });
    } catch (e) {
      item.draft = '';
      item.error = e.message;
      console.error(`[draft] ${item.key}: ${e.message}`);
    }
    const mention = addMention(item);
    const owner = await client.users.fetch(OWNER);
    const dm = await owner.send({ embeds: render(mention), components: buttons(mention.id) });
    updateMention(mention, { dm: { channelId: dm.channelId, messageId: dm.id } });
    markSeen(item.key);
    console.log(`[queued] ${item.key} (${item.where})`);
  } finally {
    inFlight.delete(item.key);
  }
}

// When I decide on the board, the DM shows it and loses its buttons.
onDecided(async (mention) => {
  if (!mention.dm) return;
  const channel = await client.channels.fetch(mention.dm.channelId);
  const message = await channel.messages.fetch(mention.dm.messageId);
  await message.edit({
    embeds: render(mention, STATUS_TEXT[mention.status] || mention.status),
    content: mention.sentUrl || '',
    components: [],
  });
});

// A Discord reply goes as a reply to the message that mentioned me. parse: [] stops it from
// pinging @everyone, roles or other users.
registerSender('discord', async (target, text) => {
  const channel = await client.channels.fetch(target.channelId);
  const message = await channel.messages.fetch(target.messageId);
  return (await message.reply({ content: text, allowedMentions: { parse: [], repliedUser: true } })).url;
});

/** DMs me the outcome of a task-board run. */
export async function notifyTask(card) {
  const ok = card.status === 'done';
  const embed = new EmbedBuilder()
    .setTitle(clip(`${ok ? 'Task done' : 'Task failed'}: ${card.title}`, 256))
    .setDescription(clip(ok ? card.result : card.error, 4000) || '(no output)')
    .setFooter({ text: clip(card.sessionId ? `${card.dir} · claude --resume ${card.sessionId}` : card.dir, 2000) });
  const owner = await client.users.fetch(OWNER);
  await owner.send({ embeds: [embed] });
}

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
    context = [...earlier.values()].reverse()
      .map((m) => `${m.author.username}: ${clip(m.cleanContent, 400)}`).join('\n');
  } catch { /* no Read Message History permission: draft without context */ }

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

const CATCHUP_MS = (Number(process.env.CATCHUP_HOURS) || 24) * 60 * 60 * 1000;

/**
 * On start, offers the mentions from the last CATCHUP_HOURS that arrived while the bot was
 * off (Discord doesn't replay them). Ones already handled are skipped by requestApproval.
 */
export async function catchUpDiscord() {
  const after = Date.now() - CATCHUP_MS;
  const found = [];
  for (const guild of client.guilds.cache.values()) {
    const channels = [...(await guild.channels.fetch()).values()].filter((c) => c?.isTextBased());
    const threads = [...(await guild.channels.fetchActiveThreads()).threads.values()];
    for (const channel of [...channels, ...threads]) {
      try {
        const recent = await channel.messages.fetch({ limit: 100 });
        for (const m of recent.values()) {
          if (m.createdTimestamp >= after && m.mentions.users.has(OWNER) && !hasSeen(`discord:${m.id}`)) found.push(m);
        }
      } catch { /* no access to this channel */ }
    }
  }
  found.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  console.log(`[discord] catch-up: ${found.length} mention(s) from the last ${CATCHUP_MS / 3600000}h`);
  for (const m of found) await handleMessage(m);
}

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isButton() && !interaction.isModalSubmit()) return;
  try {
    if (interaction.user.id !== OWNER) {
      return await interaction.reply({ content: 'This is not yours to approve.', flags: MessageFlags.Ephemeral });
    }
    const [action, id] = interaction.customId.split(':');
    const item = findMention(id);
    if (!item) {
      return await interaction.update({ content: 'This mention is no longer kept. Nothing was sent.', components: [] });
    }
    if (item.status !== 'waiting') {
      return await interaction.update({ embeds: render(item, STATUS_TEXT[item.status] || item.status), content: item.sentUrl || '', components: [] });
    }

    if (action === 'edit') {
      const input = new TextInputBuilder()
        .setCustomId('text').setLabel('Reply').setStyle(TextInputStyle.Paragraph)
        .setRequired(true).setMaxLength(Math.min(item.maxLen, MODAL_MAX));
      if (item.draft) input.setValue(item.draft.slice(0, Math.min(item.maxLen, MODAL_MAX)));
      return await interaction.showModal(new ModalBuilder()
        .setCustomId(`save:${id}`).setTitle('Edit reply')
        .addComponents(new ActionRowBuilder().addComponents(input)));
    }

    if (action === 'save') {
      updateMention(item, { draft: interaction.fields.getTextInputValue('text').trim(), error: undefined });
      return await interaction.update({ embeds: render(item, 'Draft reply (edited) — not sent yet'), components: buttons(id) });
    }

    if (action === 'skip') {
      closeMention(item, 'skipped'); // onDecided updates this DM
      return await interaction.deferUpdate();
    }

    if (action === 'send') {
      if (!item.draft) {
        return await interaction.reply({ content: 'The draft is empty. Press Edit first.', flags: MessageFlags.Ephemeral });
      }
      if (item.draft.length > item.maxLen) {
        return await interaction.reply({
          content: `The draft is ${item.draft.length} characters; ${item.source} allows ${item.maxLen} here. Press Edit to shorten it.`,
          flags: MessageFlags.Ephemeral,
        });
      }
      await interaction.deferUpdate();
      try {
        await sendMention(item, item.draft); // onDecided updates this DM
      } catch (e) {
        console.error(`[send] ${item.key}: ${e.message}`);
        await interaction.followUp({ content: `Not sent: ${clip(e.message, 300)}` });
      }
    }
  } catch (e) {
    console.error(`[interaction] ${e.message}`);
  }
});
