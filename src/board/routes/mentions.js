import { Router } from 'express';
import { closeMention, findMention, replyProblem, sendMention, updateMention } from '../../store/mentions.js';
import { addCard, folders } from '../../store/tasks.js';
import { mentionView, NOTICES } from '../view-models.js';

// A mention's reply page and its buttons: send, save draft, skip, make it a task.

export const mentionRoutes = Router();

mentionRoutes.get('/mentions/:id', (req, res) => {
  const mention = findMention(req.params.id);
  if (!mention) return res.status(404).render('pages/not-found.njk');
  return res.render('pages/mention.njk', {
    mention: mentionView(mention),
    reply: mention.draft,
    notice: NOTICES[req.query.notice],
  });
});

mentionRoutes.post('/mentions/:id/:action', async (req, res) => {
  const mention = findMention(req.params.id);
  if (!mention) return res.status(404).render('pages/not-found.njk');

  const reply = typeof req.body.reply === 'string' ? req.body.reply : mention.draft;
  const showProblem = (problem, code = 400) =>
    res.status(code).render('pages/mention.njk', { mention: mentionView(mention), reply, problem });

  if (mention.status !== 'waiting') return showProblem(`This mention is already ${mention.status}.`, 409);

  try {
    switch (req.params.action) {
      case 'save':
        updateMention(mention, { draft: reply.trim(), error: undefined });
        return res.redirect(303, `/mentions/${mention.id}?notice=saved`);

      case 'send': {
        const problem = replyProblem(mention, reply);
        if (problem) return showProblem(problem);
        await sendMention(mention, reply);
        return res.redirect(303, '/?notice=sent');
      }

      case 'skip':
        closeMention(mention, 'skipped');
        return res.redirect(303, '/?notice=skipped');

      case 'task': {
        const card = addCard({
          title: `Follow up: ${mention.author} on ${mention.where}`.slice(0, 300),
          notes: [
            `${mention.source} mention from ${mention.author} (${mention.link}):`,
            '',
            mention.message,
          ].join('\n'),
          dir: folders()[0].path,
        });
        closeMention(mention, 'task');
        return res.redirect(303, `/tasks/${card.id}?notice=tasked`);
      }

      default:
        return res.status(404).render('pages/not-found.njk');
    }
  } catch (e) {
    return showProblem(`Not sent: ${e.message}`, 502);
  }
});
