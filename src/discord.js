import { randomUUID } from 'node:crypto';
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, Client, EmbedBuilder, Events,
  GatewayIntentBits, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { draftReply } from './claude.js';
import { hasSeen, markSeen } from './state.js';

const OWNER = process.env.DISCORD_OWNER_ID;
const MODAL_MAX = 4000; // Discord's limit for a modal text field

// Drafts waiting for a decision. Kept in memory only: after a restart the old
// DMs' buttons answer "expired" and nothing is sent.
const pending = new Map();
const inFlight = new Set();

export const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const clip = (s, n) => (s && s.length > n ? `${s.slice(0, n)}…` : s || '');

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
 * Drafts a reply for one mention and DMs it to the owner with Send / Edit /
 * Skip. Nothing is posted anywhere until the owner presses Send.
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
    const id = randomUUID();
    pending.set(id, item);
    const owner = await client.users.fetch(OWNER);
    await owner.send({ embeds: render(item), components: buttons(id) });
    markSeen(item.key);
    console.log(`[queued] ${item.key} (${item.where})`);
  } finally {
    inFlight.delete(item.key);
  }
}

client.on(Events.MessageCreate, async (msg) => {
  if (msg.author.bot || msg.author.id === OWNER || !msg.inGuild()) return;
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
    // parse: [] stops the reply from pinging @everyone, roles or other users.
    send: async (text) => (await msg.reply({
      content: text,
      allowedMentions: { parse: [], repliedUser: true },
    })).url,
  }).catch((e) => console.error(`[discord] ${msg.id}: ${e.message}`));
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isButton() && !interaction.isModalSubmit()) return;
  try {
    if (interaction.user.id !== OWNER) {
      return await interaction.reply({ content: 'This is not yours to approve.', flags: MessageFlags.Ephemeral });
    }
    const [action, id] = interaction.customId.split(':');
    const item = pending.get(id);
    if (!item) {
      return await interaction.update({ content: 'Expired (the bot restarted). Nothing was sent.', components: [] });
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
      item.draft = interaction.fields.getTextInputValue('text').trim();
      item.error = undefined;
      return await interaction.update({ embeds: render(item, 'Draft reply (edited) — not sent yet'), components: buttons(id) });
    }

    if (action === 'skip') {
      pending.delete(id);
      return await interaction.update({ embeds: render(item, 'Skipped — nothing sent'), components: [] });
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
        const url = await item.send(item.draft);
        pending.delete(id);
        await interaction.editReply({ embeds: render(item, 'Sent'), content: url, components: [] });
        console.log(`[sent] ${item.key} -> ${url}`);
      } catch (e) {
        console.error(`[send] ${item.key}: ${e.message}`);
        await interaction.followUp({ content: `Not sent: ${clip(e.message, 300)}` });
      }
    }
  } catch (e) {
    console.error(`[interaction] ${e.message}`);
  }
});
