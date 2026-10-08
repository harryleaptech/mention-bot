# mention-bot

DMs you every Discord and GitHub mention with a reply drafted by your local
Claude Code login, and posts the reply only after you press **Send**.

## Setup

1. **Discord bot**
   - https://discord.com/developers/applications > New Application > Bot.
   - Turn on **Message Content Intent** (Bot page, Privileged Gateway Intents).
   - Copy the bot token into `.env` as `DISCORD_TOKEN`.
   - Invite it: OAuth2 > URL Generator > scope `bot`, permissions
     View Channels, Send Messages, Read Message History. Open the URL and add
     it to each server you want watched.
2. **Your Discord user ID** into `DISCORD_OWNER_ID`
   (Settings > Advanced > Developer Mode, then right-click yourself > Copy User ID).
   You must share a server with the bot and allow DMs from server members.
3. **GitHub token** (optional) into `GITHUB_TOKEN`: a classic personal access
   token with `notifications`, plus `repo` for private repos.
4. **Claude Code** must be installed and logged in on this machine (`claude`).

```bash
cp .env.example .env
```

```bash
npm install
```

```bash
npm start
```

## How it behaves

- Discord: any message in a watched server that @mentions you (or replies to
  you with the ping on). The reply is posted by the bot, as a reply to that message.
- GitHub: unread notifications whose reason is `mention`, on issues and pull
  requests. The reply is posted as a normal comment **under your account**.
- Each DM has **Send**, **Edit** and **Skip**. Nothing is posted until Send.
- `state.json` remembers handled mentions across restarts. Drafts waiting for a
  decision are in memory only; after a restart their buttons say "Expired".
- The first run sends a DM for every GitHub mention that is still unread.

## Limits

- The bot only sees Discord servers it was invited to, and no DMs.
- GitHub inline review comments and discussions are not handled.
- Every draft uses your Claude subscription usage.
