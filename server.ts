import 'dotenv/config';
import express, { Express } from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { requireAuth, requireRole } from './app/middleware/auth';
import { rateLimit } from './app/middleware/rateLimit';
import { correlationMiddleware, sanitizedErrorHandler } from './app/middleware/correlation';
import { securityHeaders, corsMiddleware } from './app/middleware/securityHeaders';
import { enforceProductionConfig, getStartupHealthStatus } from './app/config/productionConfig';
import { logger } from './app/services/security/logger';
import { callService } from './app/services/calls/callService';
import { processSarvamWebhook } from './app/services/voice/sarvamWebhook';
import { transcriptIngestionService } from './app/services/voice/transcriptIngestionService';
import { supabaseDataService } from './app/services/supabase/repositories';
import { scoutAdapter } from './app/services/scout/scoutAdapter';
import { conversationExtractionService } from './app/services/gemini/conversationExtractionService';
import { buyerQualificationService } from './app/services/qualification/buyerQualificationService';
import { buyerScoringService } from './app/services/scoring/buyerScoringService';
import { projectMatchingService } from './app/services/matching/projectMatchingService';
import { brokerHandoffService } from './app/services/handoff/brokerHandoffService';
import { matchingAgent } from './app/agents/MatchingAgent';

export function createApp(): Express {
  // If in production, fail-fast validate configuration immediately
  if (process.env.NODE_ENV === 'production') {
    enforceProductionConfig();
  }

  const app = express();

  // Security headers & CORS boundaries
  app.use(securityHeaders());
  app.use(corsMiddleware());

  // JSON body parser
  app.use(express.json());

  // Attach correlation and request ID propagation middleware
  app.use(correlationMiddleware());

  // --- PUBLIC API ROUTES ---

  // Minimal public health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', service: 'GrowthForge Buyer Engine', timestamp: new Date().toISOString() });
  });

  // Authenticated operational diagnostics endpoint (Requires Admin or Platform Admin)
  app.get('/api/health/diagnostics', requireAuth(), requireRole('ADMIN', 'OWNER', 'PLATFORM_ADMIN'), (req, res) => {
    const diagnostics = getStartupHealthStatus();
    res.json(diagnostics);
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

  // Sarvam Webhook / Status Callback Handler (Provider authenticated via webhook secret)
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

  // --- PROTECTED API ROUTES (Require Authentication) ---

  // Start Outbound Voice Qualification Call
  app.post('/api/voice/start-call', requireAuth(), requireRole('SALES', 'ADMIN', 'OWNER'), rateLimit('sarvam_api', 50, 3600), async (req, res) => {
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

  // Call Status & Telemetry
  app.get('/api/voice/status/:callId', requireAuth(), async (req, res) => {
    try {
      const status = await callService.getCallStatus(req.params.callId);
      res.json(status);
    } catch (err: unknown) {
      res.status(404).json({ error: err instanceof Error ? err.message : 'Call not found' });
    }
  });

  // Call Transcript Retrieval (Phase 5A)
  app.get('/api/voice/transcripts/:callId', requireAuth(), async (req, res) => {
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
  app.get('/api/voice/transcripts/lead/:leadId', requireAuth(), async (req, res) => {
    try {
      const transcripts = await supabaseDataService.transcripts.getTranscriptsByLeadId(req.params.leadId);
      res.json(transcripts);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to get transcripts' });
    }
  });

  // Direct Ingest Transcript Endpoint (Internal/Testing)
  app.post('/api/voice/transcripts/ingest', requireAuth(), requireRole('SALES', 'ADMIN', 'OWNER'), rateLimit('api_ingest', 100, 3600), async (req, res) => {
    try {
      const result = await transcriptIngestionService.ingestTranscript(req.body);
      res.json(result);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Transcript ingestion failed' });
    }
  });

  // Extract Structured Buyer Intelligence (Phase 5B)
  app.post('/api/voice/extractions/extract', requireAuth(), requireRole('SALES', 'ADMIN', 'OWNER'), rateLimit('gemini_api', 100, 3600), async (req, res) => {
    try {
      const result = await conversationExtractionService.extractFromTranscript(req.body);
      res.json(result);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Structured extraction failed' });
    }
  });

  // Call Extraction Retrieval (Phase 5B)
  app.get('/api/voice/extractions/call/:callId', requireAuth(), async (req, res) => {
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
  app.get('/api/voice/extractions/transcript/:transcriptId', requireAuth(), async (req, res) => {
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
  app.get('/api/voice/extractions/lead/:leadId', requireAuth(), async (req, res) => {
    try {
      const extractions = await conversationExtractionService.getExtractionsByLeadId(req.params.leadId);
      res.json(extractions);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to get extractions' });
    }
  });

  // Qualify Buyer (Phase 5C)
  app.post('/api/qualification/qualify', requireAuth(), requireRole('SALES', 'ADMIN', 'OWNER'), rateLimit('gemini_api', 100, 3600), async (req, res) => {
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
  app.get('/api/qualification/:id', requireAuth(), async (req, res) => {
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
  app.get('/api/qualification/extraction/:extractionId', requireAuth(), async (req, res) => {
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
  app.get('/api/qualification/lead/:leadId', requireAuth(), async (req, res) => {
    try {
      const qualifications = await supabaseDataService.qualifications.getQualificationsByLeadId(
        req.params.leadId
      );
      res.json(qualifications);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to get qualifications' });
    }
  });

  // --- BUYER SCORING & PRIORITIZATION ENDPOINTS (Phase 5D) ---

  // Score Buyer
  app.post('/api/scoring/score', requireAuth(), requireRole('SALES', 'ADMIN', 'OWNER'), rateLimit('gemini_api', 100, 3600), async (req, res) => {
    try {
      const { qualificationId, leadId, forceRescore, ruleVersion } = req.body;
      if (!qualificationId && !leadId) {
        return res.status(400).json({ error: 'Either qualificationId or leadId is required' });
      }

      let result;
      if (qualificationId) {
        result = await buyerScoringService.scoreQualification({
          qualificationId,
          forceRescore,
          ruleVersion,
        });
      } else {
        result = await buyerScoringService.scoreLead({
          leadId,
          forceRescore,
          ruleVersion,
        });
      }

      res.json(result);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Buyer scoring failed' });
    }
  });

  // Get Prioritized Dispatch Queue (Phase 5D)
  app.get('/api/scoring/queue/priority', requireAuth(), async (req, res) => {
    try {
      const { tier, limit } = req.query;
      const queue = await buyerScoringService.getPriorityQueue({
        tier: typeof tier === 'string' ? tier : undefined,
        limit: limit ? parseInt(limit as string, 10) : undefined,
      });
      res.json(queue);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to get priority queue' });
    }
  });

  // Get Score Record by ID (Phase 5D)
  app.get('/api/scoring/:id', requireAuth(), async (req, res) => {
    try {
      const score = await supabaseDataService.buyerScores.getBuyerScore(req.params.id);
      if (!score) {
        return res.status(404).json({ error: 'Score record not found' });
      }
      res.json(score);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to get score record' });
    }
  });

  // Get Score Record by Qualification ID (Phase 5D)
  app.get('/api/scoring/qualification/:qualificationId', requireAuth(), async (req, res) => {
    try {
      const score = await supabaseDataService.buyerScores.getBuyerScoreByQualificationId(
        req.params.qualificationId
      );
      if (!score) {
        return res.status(404).json({ error: 'Score not found for this qualification' });
      }
      res.json(score);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to get score' });
    }
  });

  // Get Score Records by Lead ID (Phase 5D)
  app.get('/api/scoring/lead/:leadId', requireAuth(), async (req, res) => {
    try {
      const scores = await supabaseDataService.buyerScores.getBuyerScoresByLeadId(
        req.params.leadId
      );
      res.json(scores);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to get scores' });
    }
  });

  // --- PROJECT MATCHING & RECOMMENDATIONS ENDPOINTS (Phase 5E) ---

  // Match Buyer Requirements
  app.post('/api/matching/match', requireAuth(), requireRole('SALES', 'ADMIN', 'OWNER'), rateLimit('gemini_api', 100, 3600), async (req, res) => {
    try {
      const { leadId, qualificationId, extractionId, forceRematch, ruleVersion, catalogVersion } = req.body;
      if (!leadId) {
        return res.status(400).json({ error: 'leadId is required' });
      }

      const result = await projectMatchingService.matchBuyerRequirements({
        leadId,
        qualificationId,
        extractionId,
        forceRematch,
        ruleVersion,
        catalogVersion,
      });
      res.json(result);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Project matching failed' });
    }
  });

  // Get Matches for Lead (Phase 5E)
  app.get('/api/matching/lead/:leadId', requireAuth(), async (req, res) => {
    try {
      const recommendations = await projectMatchingService.getMatchesForLead(req.params.leadId);
      res.json(recommendations);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to get recommendations' });
    }
  });

  // List Active Project Catalog (Phase 5E)
  app.get('/api/matching/projects', requireAuth(), async (req, res) => {
    try {
      const { city, status, limit } = req.query;
      const projects = await supabaseDataService.projects.listProjects({
        city: typeof city === 'string' ? city : undefined,
        status: typeof status === 'string' ? status : undefined,
        limit: limit ? Number(limit) : undefined,
      });
      res.json(projects);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to get projects' });
    }
  });

  // ========================================================
  // PHASE 5F — BROKER HANDOFF & CRM ROUTING ENDPOINTS
  // ========================================================

  // Create or return existing Broker Handoff Package
  app.post('/api/handoff/create', requireAuth(), requireRole('SALES', 'ADMIN', 'OWNER'), async (req, res) => {
    try {
      const { leadId, qualificationId, scoreId, forceRegenerate, ruleVersion } = req.body;
      if (!leadId) {
        return res.status(400).json({ error: 'leadId is required' });
      }
      const result = await brokerHandoffService.generateHandoff({
        leadId,
        qualificationId,
        scoreId,
        forceRegenerate,
        ruleVersion,
      });

      if (!result.success) {
        return res.status(400).json(result);
      }
      res.json(result);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Broker handoff creation failed' });
    }
  });

  // Get Priority Broker Handoff Queue (Deterministically Ordered)
  app.get('/api/handoff/queue', requireAuth(), async (req, res) => {
    try {
      const { tier, status, limit } = req.query;
      const queue = await brokerHandoffService.getHandoffQueue({
        tier: typeof tier === 'string' ? tier : undefined,
        status: typeof status === 'string' ? status : undefined,
        limit: limit ? Number(limit) : undefined,
      });
      res.json(queue);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to retrieve handoff queue' });
    }
  });

  // Get Broker Handoff by Handoff ID
  app.get('/api/handoff/:id', requireAuth(), async (req, res) => {
    try {
      const handoff = await brokerHandoffService.getHandoff(req.params.id);
      if (!handoff) {
        return res.status(404).json({ error: `Handoff with id ${req.params.id} not found` });
      }
      res.json(handoff);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to retrieve handoff' });
    }
  });

  // Get Broker Handoffs for a Lead
  app.get('/api/handoff/lead/:leadId', requireAuth(), async (req, res) => {
    try {
      const handoffs = await supabaseDataService.brokerHandoffs.getHandoffsByLeadId(req.params.leadId);
      res.json(handoffs);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to retrieve handoffs for lead' });
    }
  });

  // Dispatch Broker Handoff (Mock / Dry-Run Safe by Default)
  app.post('/api/handoff/:id/dispatch', requireAuth(), requireRole('SALES', 'ADMIN', 'OWNER'), async (req, res) => {
    try {
      const { channel, dryRun = true, forceRedispatch } = req.body;
      const result = await brokerHandoffService.dispatchHandoff(req.params.id, {
        channel,
        dryRun,
        forceRedispatch,
      });
      res.json(result);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Dispatch failed' });
    }
  });

  // Acknowledge Broker Handoff Receipt
  app.post('/api/handoff/:id/acknowledge', requireAuth(), requireRole('SALES', 'ADMIN', 'OWNER'), async (req, res) => {
    try {
      const { acknowledgedBy, notes } = req.body;
      const updated = await brokerHandoffService.acknowledgeHandoff(req.params.id, {
        acknowledgedBy,
        notes,
      });
      res.json(updated);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Acknowledgment failed' });
    }
  });

  // Scout Public Enrichment Endpoint
  app.post('/api/enrich', requireAuth(), requireRole('SALES', 'ADMIN', 'OWNER'), rateLimit('scout_api', 100, 3600), async (req, res) => {
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

  // Global sanitized error handler (Phase 8A.9)
  app.use(sanitizedErrorHandler());

  return app;
}

export async function startServer() {
  const app = createApp();
  const PORT = 3000;

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
    logger.info(`GrowthForge Server running on http://0.0.0.0:${PORT}`, {
      service: 'http-server',
      operation: 'startServer',
      status: 'LISTENING',
    });
  });
}

// Only start the server directly if executed as main entrypoint
const isDirectEntry = Boolean(
  process.argv[1] &&
  (process.argv[1].endsWith('server.ts') || process.argv[1].endsWith('server.cjs') || process.argv[1].endsWith('server.js'))
);

if (isDirectEntry && process.env.NODE_ENV !== 'test') {
  startServer();
}
