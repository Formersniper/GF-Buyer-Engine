import 'dotenv/config';
import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { callService } from './app/services/calls/callService';
import { processSarvamWebhook } from './app/services/voice/sarvamWebhook';
import { scoutAdapter } from './app/services/scout/scoutAdapter';

async function startServer() {
  const app = express();
  const PORT = 3000;

  // JSON body parser
  app.use(express.json());

  // --- API ROUTES ---

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', service: 'GrowthForge Buyer Engine', timestamp: new Date().toISOString() });
  });

  // Voice Provider Health (Safe, never leaks keys)
  app.get('/api/voice/health', async (req, res) => {
    try {
      const health = await callService.checkVoiceHealth();
      res.json(health);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to retrieve voice health' });
    }
  });

  // Start Outbound Voice Qualification Call
  app.post('/api/voice/start-call', async (req, res) => {
    try {
      const { leadId, customVariables } = req.body;
      if (!leadId) {
        return res.status(400).json({ error: 'leadId is required' });
      }

      const result = await callService.startCall(leadId, {
        customVariables,
        actor: 'human_operator',
      });

      res.json(result);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Call dispatching failed' });
    }
  });

  // Sarvam Webhook / Status Callback Handler
  app.post('/api/voice/sarvam/webhook', async (req, res) => {
    try {
      const payload = req.body;
      const headers = req.headers as Record<string, string | string[] | undefined>;
      const result = await processSarvamWebhook(payload, headers);
      res.json(result);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Webhook processing error' });
    }
  });

  // Call Status & Telemetry
  app.get('/api/voice/status/:callId', async (req, res) => {
    try {
      const status = await callService.getCallStatus(req.params.callId);
      res.json(status);
    } catch (err: unknown) {
      res.status(404).json({ error: err instanceof Error ? err.message : 'Call not found' });
    }
  });

  // Scout Public Enrichment Endpoint
  app.post('/api/enrich', async (req, res) => {
    try {
      const { leadId, identifiers } = req.body;
      if (!leadId) {
        return res.status(400).json({ error: 'leadId is required' });
      }
      const enriched = await scoutAdapter.enrichLead(leadId, identifiers || {});
      res.json({ success: true, enriched });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Enrichment failed' });
    }
  });

  // --- VITE MIDDLEWARE / STATIC ASSETS ---

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`GrowthForge Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
