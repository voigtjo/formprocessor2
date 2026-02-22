import type { FastifyInstance } from 'fastify';

export async function uiRoutes(app: FastifyInstance) {
  app.get('/', async (_req, reply) => reply.redirect('/templates'));

  app.get('/templates', async (_req, reply) => {
    return reply.view('templates/index.ejs', { items: [] });
  });

  app.get('/documents', async (_req, reply) => {
    return reply.view('documents/index.ejs', { items: [] });
  });
}
