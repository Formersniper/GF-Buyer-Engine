import 'dotenv/config';
import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { callService } from './app/services/calls/callService';
import { processSarvamWebhook } from './app/services/voice/sarvamWebhook';
import { transcriptIngestionService } from './app/services/voice/transcriptIngestionService';
import { supabaseDataService } from './app/services/supabase/repositories';
import { scoutAdapter } from './app/services/scout/scoutAdapter';
import { conversationExtractionService } from './app/services/gemini/conversationExtractionService';
import { buyerQualificationService } from './app/services/qualification/buyerQualificationService';

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

  // Call Transcript Retrieval (Phase 5A)
  app.get('/api/voice/transcripts/:callId', async (req, res) => {
    try {
      const transcript = await supabaseDataService.transcripts.getTranscriptByCallId(req.params.callId);
      if (!transcript) {
        return res.status(404).json({ error: 'Transcript not found for this call' });
      }
      res.json(transcript);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to get transcript' });
    }
  });

  // Lead Transcripts Retrieval (Phase 5A)
  app.get('/api/voice/transcripts/lead/:leadId', async (req, res) => {
    try {
      const transcripts = await supabaseDataService.transcripts.getTranscriptsByLeadId(req.params.leadId);
      res.json(transcripts);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to get transcripts' });
    }
  });

  // Direct Ingest Transcript Endpoint (Internal/Testing)
  app.post('/api/voice/transcripts/ingest', async (req, res) => {
    try {
      const result = await transcriptIngestionService.ingestTranscript(req.body);
      res.json(result);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Transcript ingestion failed' });
    }
  });

  // Extract Structured Buyer Intelligence (Phase 5B)
  app.post('/api/voice/extractions/extract', async (req, res) => {
    try {
      const result = await conversationExtractionService.extractFromTranscript(req.body);
      res.json(result);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Structured extraction failed' });
    }
  });

  // Call Extraction Retrieval (Phase 5B)
  app.get('/api/voice/extractions/call/:callId', async (req, res) => {
    try {
      const extraction = await conversationExtractionService.getExtractionByCallId(req.params.callId);
      if (!extraction) {
        return res.status(404).json({ error: 'Extraction not found for this call' });
      }
      res.json(extraction);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to get extraction' });
    }
  });

  // Transcript Extraction Retrieval (Phase 5B)
  app.get('/api/voice/extractions/transcript/:transcriptId', async (req, res) => {
    try {
      const extraction = await conversationExtractionService.getExtractionByTranscriptId(req.params.transcriptId);
      if (!extraction) {
        return res.status(404).json({ error: 'Extraction not found for this transcript' });
      }
      res.json(extraction);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to get extraction' });
    }
  });

  // Lead Extractions Retrieval (Phase 5B)
  app.get('/api/voice/extractions/lead/:leadId', async (req, res) => {
    try {
      const extractions = await conversationExtractionService.getExtractionsByLeadId(req.params.leadId);
      res.json(extractions);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to get extractions' });
    }
  });

  // Qualify Buyer (Phase 5C)
  app.post('/api/qualification/qualify', async (req, res) => {
    try {
      const { extractionId, leadId, forceRequalify, ruleVersion } = req.body;
      if (!extractionId && !leadId) {
        return res.status(400).json({ error: 'Either extractionId or leadId is required' });
      }

      let result;
      if (extractionId) {
        result = await buyerQualificationService.qualifyExtraction({
          extractionId,
          forceRequalify,
          ruleVersion,
        });
      } else {
        result = await buyerQualificationService.qualifyLead({
          leadId,
          forceRequalify,
          ruleVersion,
        });
      }

      res.json(result);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Buyer qualification failed' });
    }
  });

  // Get Qualification by ID (Phase 5C)
  app.get('/api/qualification/:id', async (req, res) => {
    try {
      const qualification = await supabaseDataService.qualifications.getQualification(req.params.id);
      if (!qualification) {
        return res.status(404).json({ error: 'Qualification record not found' });
      }
      res.json(qualification);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to get qualification' });
    }
  });

  // Get Qualification by Extraction ID (Phase 5C)
  app.get('/api/qualification/extraction/:extractionId', async (req, res) => {
    try {
      const qualification = await supabaseDataService.qualifications.getQualificationByExtractionId(
        req.params.extractionId
      );
      if (!qualification) {
        return res.status(404).json({ error: 'Qualification not found for this extraction' });
      }
      res.json(qualification);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to get qualification' });
    }
  });

  // Get Qualifications by Lead ID (Phase 5C)
  app.get('/api/qualification/lead/:leadId', async (req, res) => {
    try {
      const qualifications = await supabaseDataService.qualifications.getQualificationsByLeadId(
        req.params.leadId
      );
      res.json(qualifications);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to get qualifications' });
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
