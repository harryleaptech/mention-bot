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
  you with the ping on), from people **and other bots** (Jack's Claude, the desk);
  only this bot's own messages are skipped. The reply is posted by the bot, as a
  reply to that message.
- GitHub: also PR review texts that @mention you, not only comments.
- GitHub: unread notifications whose reason is `mention`, on issues and pull
  requests. The reply is posted as a normal comment **under your account**.
- Each DM has **Send**, **Edit** and **Skip**. Nothing is posted until Send.
- The same mentions wait in the **Mentions** column of the task board, with Send, Edit
  (a reply page), Skip and **Make it a task**. Deciding in one place closes the other.
  Waiting mentions are kept in `mentions.json`, so their buttons still work after a restart.
- **Catch-up:** on every start the bot looks back `CATCHUP_HOURS` (default 24)
  on Discord and GitHub, so a mention sent while it was off still reaches you.
- `state.json` remembers handled mentions across restarts.
- The first run sends a DM for every GitHub mention that is still unread.

## Design check posts

Posts a design preview as one forum post, then puts its link in the team channel.
Set the three `DESIGN_CHECK_*` values in `.env` first.

```bash
npm run design-check -- path/to/PREVIEW.md
```

```bash
npm run design-check -- path/to/PREVIEW.md --post
```

The first command is a dry run: it prints every message and posts nothing.

The preview file:

- `# <EPIC/story> · <screen or feature>` is the forum post title (100 characters at most).
- `Line: <story, what it is in a few words>` is the text for the team channel; the link is added after it. Without it, the title is used.
- Each `## ` section becomes one message in the post. Text above the first section goes with it.
- An image or video named in a section (`1-list.png`) is attached to that section's message when the file sits in the same folder as the preview.
- `@D` becomes a real mention of `DESIGN_CHECK_MENTION_ID`.

The post gets the "Waiting review" tag. A title is posted only once; a new
version goes inside the existing post by hand (`--again` forces a new post).

## Task board

A kanban at **http://127.0.0.1:4747** for tasks you hand to Claude Code. Set
`BOARD_DIRS` in `.env` to the folders a task may run in (comma-separated), then
`npm start`.

The pages use [GOV.UK Frontend](https://frontend.design-system.service.gov.uk/)
components with Nunjucks, served by Express (`src/board-server.js`, `views/`,
`public/`). Not a government service, so no crown, no GOV.UK name and no GDS
Transport font (`public/board.css` swaps in the system font). Every page works
without JavaScript. With it, the board updates live: the bot pushes a signal
(Server-Sent Events, `/events`) the moment a mention arrives or a task changes,
and only that column is redrawn.

- **Add a task** with what Claude should do, optional details and a folder, then
  **Add and start** or **Add to To do**.
- **Start task** sends it to **Doing** and runs it: the local `claude` login works
  on it in that folder, one task at a time (the rest wait). When it finishes the
  card moves to **Done** with Claude's summary, or stays in Doing marked failed
  (**Run again**), and the bot DMs you. **Move back to To do**, **Mark as done**
  and **Delete** (with a confirm page) are on each card.
- **Continue in a terminal:** each run keeps its session; the card shows
  `claude --resume <id>`.
- **What a run may do:** read and edit files, `git add/commit`, read-only `git`
  and `gh`, run `phpunit` / `vitest`. Pushing, `gh api`, opening, merging or
  commenting on PRs and issues, `curl` and `rm` are blocked, so a task ends as
  local changes for you to check.
- **Safety:** the pages only answer on this Mac, and every form carries a key
  written into the page (and must come from the same origin), so another website
  can't start a task. The key changes when the bot restarts: a form sent from an
  older page shows "The page has expired"; go back to the board.
- Cards are kept in `board.json`. A run cut off by a restart is marked failed.
- Each run uses your Claude subscription. A run stops after `BOARD_TIMEOUT_MINUTES`.

## Limits

- The bot only sees Discord servers it was invited to, and no DMs.
- GitHub inline review comments and discussions are not handled.
- Every draft uses your Claude subscription usage.
