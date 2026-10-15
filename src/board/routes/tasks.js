import { Router } from 'express';
import { addCard, deleteCard, findCard, folders, moveCard, validate } from '../../store/tasks.js';
import { startCard } from '../runner.js';
import { NOTICES, taskView } from '../view-models.js';

// Adding a task, its page, and its buttons (start, back to To do, mark as done, delete).

export const taskRoutes = Router();

const notFound = (res) => res.status(404).render('pages/not-found.njk');

taskRoutes.get('/tasks/new', (req, res) => {
  res.render('pages/new-task.njk', { folders: folders(), values: { dir: folders()[0]?.path } });
});

taskRoutes.post('/tasks', (req, res) => {
  const values = { title: req.body.title, notes: req.body.notes, dir: req.body.dir };
  const errors = validate(values);
  if (Object.keys(errors).length) {
    return res.status(400).render('pages/new-task.njk', { folders: folders(), values, errors });
  }
  const card = addCard(values);
  if (req.body.action === 'start') {
    startCard(card);
    return res.redirect(303, '/?notice=started');
  }
  return res.redirect(303, '/?notice=added');
});

taskRoutes.get('/tasks/:id', (req, res) => {
  const card = findCard(req.params.id);
  if (!card) return notFound(res);
  return res.render('pages/task.njk', { card: taskView(card), notice: NOTICES[req.query.notice] });
});

taskRoutes.get('/tasks/:id/delete', (req, res) => {
  const card = findCard(req.params.id);
  if (!card) return notFound(res);
  return res.render('pages/delete-task.njk', { card: taskView(card) });
});

taskRoutes.post('/tasks/:id/:action', (req, res) => {
  const card = findCard(req.params.id);
  if (!card) return notFound(res);
  const back = req.body.back === 'task' ? `/tasks/${card.id}` : '/';
  try {
    switch (req.params.action) {
      case 'start':
        startCard(card);
        return res.redirect(303, `${back}?notice=started`);
      case 'todo':
      case 'done':
        moveCard(card, req.params.action);
        return res.redirect(303, `${back}?notice=${req.params.action}`);
      case 'delete':
        deleteCard(card);
        return res.redirect(303, '/?notice=deleted');
      default:
        return notFound(res);
    }
  } catch (e) {
    return res.status(409).render('pages/task.njk', { card: taskView(card), problem: e.message });
  }
});
