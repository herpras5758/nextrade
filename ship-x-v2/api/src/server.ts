import Fastify from 'fastify';
import cors from '@fastify/cors';
import { authMiddleware } from './middleware/auth.js';
import { uploadRoutes } from './routes/upload.js';
import { documentRoutes } from './routes/documents.js';
import { resolutionRoutes } from './routes/resolutions.js';
import { shipmentRoutes } from './routes/shipments.js';
import { adminRoutes } from './routes/admin.js';

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });

app.register(cors, {
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
});

// Auth on all /api/v1 routes
app.addHook('preHandler', async (req, reply) => {
  if (req.url.startsWith('/api/v1/') && req.method !== 'OPTIONS') {
    await authMiddleware(req, reply);
  }
});

// Routes
const PREFIX = '/api/v1';
app.register(uploadRoutes,    { prefix: PREFIX });
app.register(documentRoutes,  { prefix: PREFIX });
app.register(resolutionRoutes,{ prefix: PREFIX });
app.register(shipmentRoutes,  { prefix: PREFIX });
app.register(adminRoutes,     { prefix: PREFIX });

// Health
app.get('/health', async () => ({ status: 'ok', service: 'ship-x-api', ts: new Date().toISOString() }));

// Error handler
app.setErrorHandler((err, req, reply) => {
  const code = (err as any).statusCode ?? err.statusCode ?? 500;
  app.log.error(err);
  reply.code(code).send({ error: err.message, code: (err as any).code });
});

const PORT = parseInt(process.env.PORT ?? '3000');
app.listen({ port: PORT, host: '0.0.0.0' })
  .then(() => app.log.info(`Ship-X API running on port ${PORT}`))
  .catch(err => { app.log.error(err); process.exit(1); });
