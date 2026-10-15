import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  Events,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { draftReply } from '../claude/drafts.js';
import { config } from '../config.js';
import { clip } from '../lib/text.js';
import {
  addMention,
  closeMention,
  findMention,
  onDecided,
  registerSender,
  sendMention,
  updateMention,
} from '../store/mentions.js';
import { hasSeen, markSeen } from '../store/seen.js';
import { client, OWNER } from './client.js';

// The approval DM: every mention (Discord or GitHub) gets a drafted reply and Send / Edit /
// Skip buttons. The mention itself lives in store/mentions.js (shared with the task board),
// so the buttons still work after a restart, and deciding on the board closes the DM.

const MODAL_MAX = 4000; // Discord's limit for a modal text field
const inFlight = new Set();

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
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`send:${id}`).setLabel('Send').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`edit:${id}`).setLabel('Edit').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`skip:${id}`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
    ),
  ];
}

/**
 * Drafts a reply for one mention, keeps it for the board, and DMs it to me with Send / Edit /
 * Skip. Nothing is posted anywhere until I press Send.
 */
export async function requestApproval(item) {
  if (inFlight.has(item.key) || hasSeen(item.key)) return;
  inFlight.add(item.key);
  try {
    try {
      item.draft = await draftReply({ ...item, style: config.claude.replyStyle });
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

/** DMs me the outcome of a task-board run. */
export async function notifyTask(card) {
  const ok = card.status === 'done';
  const footer = card.sessionId ? `${card.dir} · claude --resume ${card.sessionId}` : card.dir;
  const embed = new EmbedBuilder()
    .setTitle(clip(`${ok ? 'Task done' : 'Task failed'}: ${card.title}`, 256))
    .setDescription(clip(ok ? card.result : card.error, 4000) || '(no output)')
    .setFooter({ text: clip(footer, 2000) });
  const owner = await client.users.fetch(OWNER);
  await owner.send({ embeds: [embed] });
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
  const reply = await message.reply({ content: text, allowedMentions: { parse: [], repliedUser: true } });
  return reply.url;
});

// ---- The DM's buttons -------------------------------------------------------------------

function editModal(id, item) {
  const max = Math.min(item.maxLen, MODAL_MAX);
  const input = new TextInputBuilder()
    .setCustomId('text')
    .setLabel('Reply')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(max);
  if (item.draft) input.setValue(item.draft.slice(0, max));
  return new ModalBuilder()
    .setCustomId(`save:${id}`)
    .setTitle('Edit reply')
    .addComponents(new ActionRowBuilder().addComponents(input));
}

async function onButton(interaction) {
  if (interaction.user.id !== OWNER) {
    return interaction.reply({ content: 'This is not yours to approve.', flags: MessageFlags.Ephemeral });
  }
  const [action, id] = interaction.customId.split(':');
  const item = findMention(id);
  if (!item) {
    return interaction.update({
      content: 'This mention is no longer kept. Nothing was sent.',
      components: [],
    });
  }
  if (item.status !== 'waiting') {
    return interaction.update({
      embeds: render(item, STATUS_TEXT[item.status] || item.status),
      content: item.sentUrl || '',
      components: [],
    });
  }

  switch (action) {
    case 'edit':
      return interaction.showModal(editModal(id, item));

    case 'save':
      updateMention(item, { draft: interaction.fields.getTextInputValue('text').trim(), error: undefined });
      return interaction.update({
        embeds: render(item, 'Draft reply (edited) — not sent yet'),
        components: buttons(id),
      });

    case 'skip':
      closeMention(item, 'skipped'); // onDecided updates this DM
      return interaction.deferUpdate();

    case 'send': {
      if (!item.draft) {
        return interaction.reply({
          content: 'The draft is empty. Press Edit first.',
          flags: MessageFlags.Ephemeral,
        });
      }
      if (item.draft.length > item.maxLen) {
        return interaction.reply({
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
      return undefined;
    }

    default:
      return undefined;
  }
}

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isButton() && !interaction.isModalSubmit()) return;
  try {
    await onButton(interaction);
  } catch (e) {
    console.error(`[interaction] ${e.message}`);
  }
});
