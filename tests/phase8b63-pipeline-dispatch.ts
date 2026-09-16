import { brokerHandoffService } from '../app/services/handoff/brokerHandoffService';
import { buyerPipelineCoordinator } from '../app/services/pipeline/buyerPipelineCoordinator';
import { supabaseDataService } from '../app/services/supabase/repositories';
import { transcriptIngestionService } from '../app/services/voice/transcriptIngestionService';
import {
  MockGeminiExtractionProvider,
  setGeminiExtractionProvider,
} from '../app/services/gemini/geminiExtractionProvider';
import crypto from 'crypto';

const TENANT_ALPHA = '00000000-0000-0000-0000-000000000001';

async function runTests() {
  console.log('=== GrowthForge Phase 8B.6.3 Pipeline Dispatch Tests ===');

  setGeminiExtractionProvider(new MockGeminiExtractionProvider());

  let dispatchCalls: any[] = [];
  const originalDispatch = brokerHandoffService.dispatchHandoff;

  const results: { name: string; passed: boolean; error?: string }[] = [];
  
  async function runTest(name: string, fn: () => Promise<void>) {
    process.stdout.write(`Testing: ${name}... `);
    try {
      dispatchCalls = [];
      await fn();
      console.log(`\x1b[32mPASSED\x1b[0m`);
      results.push({ name, passed: true });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.log(`\x1b[31mFAILED: ${errMsg}\x1b[0m`);
      results.push({ name, passed: false, error: errMsg });
    }
  }

  // Set up mock dispatch
  brokerHandoffService.dispatchHandoff = async (handoffId, opts) => {
    dispatchCalls.push({ handoffId, opts });
    return {
      success: true,
      dispatch_id: 'mock-dispatch-id',
      channel: 'mock-channel',
      status: 'SENT',
      delivered_at: new Date().toISOString(),
      action: 'SUCCESS',
    } as any;
  };

  // Helper to create a new lead and transcript
  async function createLeadAndTranscript(tenantId: string) {
    const leadId = crypto.randomUUID();
    const callId = crypto.randomUUID();
    
    await supabaseDataService.leads.createLead(
      { tenantId, isPlatformAdmin: true },
      { id: leadId, lead_id: `L-${Date.now()}`, status: 'NEW', name: 'Test User' }
    );
    
    const dbCall = await supabaseDataService.calls.createCall({
      id: callId,
      lead_id: leadId,
      tenant_id: tenantId,
      provider_call_id: `ext-${Date.now()}`,
      status: 'COMPLETED',
      started_at: new Date().toISOString(),
    });
    
    await transcriptIngestionService.ingestSarvamTranscript({
      call_id: dbCall.provider_call_id,
      transcript: 'I want a 3 BHK in Wakad for 1.5 Cr.',
    });
    
    return { leadId, callId };
  }

  await runTest('TEST A - Successful HANDOFF -> DISPATCH', async () => {
    const { leadId, callId } = await createLeadAndTranscript(TENANT_ALPHA);
    const correlationId = crypto.randomUUID();
    
    const result = await buyerPipelineCoordinator.runPipeline({
      leadId,
      tenantId: TENANT_ALPHA,
      callId,
      correlationId,
      forceRerun: false,
    });
    
    if (!result.success) throw new Error(`Pipeline failed: ${result.error}`);
    if (!result.handoff_id) throw new Error('Handoff ID missing');
    if (!result.dispatch_id) throw new Error('Dispatch ID missing');
    
    if (dispatchCalls.length !== 1) throw new Error(`Expected 1 dispatch call, got ${dispatchCalls.length}`);
    if (dispatchCalls[0].handoffId !== result.handoff_id) throw new Error('Mismatch in handoff ID passed to dispatch');
    
    if (result.stages.HANDOFF.status !== 'SUCCESS') throw new Error('HANDOFF stage not SUCCESS');
    if (result.stages.DISPATCH.status !== 'SUCCESS') throw new Error('DISPATCH stage not SUCCESS');
  });

  await runTest('TEST B - Correct Stage Ordering', async () => {
    const { leadId, callId } = await createLeadAndTranscript(TENANT_ALPHA);
    const result = await buyerPipelineCoordinator.runPipeline({
      leadId,
      tenantId: TENANT_ALPHA,
      callId,
      correlationId: crypto.randomUUID(),
    });
    
    const hTime = new Date(result.stages.HANDOFF.completed_at).getTime();
    const dTime = new Date(result.stages.DISPATCH.started_at).getTime();
    
    if (dTime < hTime) throw new Error('DISPATCH started before HANDOFF completed');
  });

  await runTest('TEST C - Dispatch Failure (No Upstream Rollback)', async () => {
    const { leadId, callId } = await createLeadAndTranscript(TENANT_ALPHA);
    
    brokerHandoffService.dispatchHandoff = async () => {
      return { success: false, action: 'DISPATCH_FAILED', error: 'Network timeout', status: 'FAILED' } as any;
    };
    
    const result = await buyerPipelineCoordinator.runPipeline({
      leadId,
      tenantId: TENANT_ALPHA,
      callId,
      correlationId: crypto.randomUUID(),
    });
    
    if (!result.success) throw new Error('Pipeline failed entirely due to dispatch failure. Should complete with dispatch failure log.');
    if (result.action !== 'PIPELINE_COMPLETED_DISPATCH_FAILED') throw new Error(`Expected action PIPELINE_COMPLETED_DISPATCH_FAILED, got ${result.action}`);
    if (result.stages.HANDOFF.status !== 'SUCCESS') throw new Error('HANDOFF was rolled back or marked failed');
    if (result.stages.DISPATCH.status !== 'FAILED') throw new Error('DISPATCH not marked FAILED');
    if (result.stages.DISPATCH.error !== 'Network timeout') throw new Error('DISPATCH error not captured');
  });

  await runTest('TEST D & E - Idempotency and Pipeline Re-run', async () => {
    brokerHandoffService.dispatchHandoff = async () => ({ success: true, action: 'SUCCESS', status: 'SENT', dispatch_id: '1' } as any);
    const { leadId, callId } = await createLeadAndTranscript(TENANT_ALPHA);
    const correlationId = crypto.randomUUID();
    
    // First run
    const run1 = await buyerPipelineCoordinator.runPipeline({ leadId, tenantId: TENANT_ALPHA, callId, correlationId });
    if (!run1.success) throw new Error('First run failed');
    
    // Now mock dispatch to return existing/duplicate
    brokerHandoffService.dispatchHandoff = async () => ({ success: true, action: 'IGNORED_DUPLICATE', status: 'ACKNOWLEDGED', dispatch_id: '1' } as any);
    
    // Second run
    const run2 = await buyerPipelineCoordinator.runPipeline({ leadId, tenantId: TENANT_ALPHA, callId, correlationId });
    if (!run2.success) throw new Error('Second run failed');
    if (run2.stages.DISPATCH.status !== 'EXISTING') throw new Error('DISPATCH did not report EXISTING on re-run');
  });

  await runTest('TEST H - Handoff Failure -> DISPATCH Skipped', async () => {
    const { leadId, callId } = await createLeadAndTranscript(TENANT_ALPHA);
    
    // Monkey-patch handoff generate to fail
    const originalGenerate = brokerHandoffService.generateHandoff;
    brokerHandoffService.generateHandoff = async () => ({ success: false, action: 'HANDOFF_FAILED' });
    
    const result = await buyerPipelineCoordinator.runPipeline({ leadId, tenantId: TENANT_ALPHA, callId, correlationId: crypto.randomUUID() });
    
    brokerHandoffService.generateHandoff = originalGenerate;
    
    if (result.success) throw new Error('Pipeline should have failed');
    if (result.stages.HANDOFF.status !== 'FAILED') throw new Error('HANDOFF not FAILED');
    if (result.stages.DISPATCH.status !== 'SKIPPED') throw new Error('DISPATCH not SKIPPED');
  });

  // Restore
  brokerHandoffService.dispatchHandoff = originalDispatch;

  const failedCount = results.filter(r => !r.passed).length;
  console.log('=============================================================');
  console.log(`Phase 8B.6.3 Pipeline Dispatch Test Suite Results: ${results.length - failedCount} Passed, ${failedCount} Failed`);
  console.log('=============================================================');
  
  if (failedCount > 0) {
    process.exit(1);
  }
}

runTests().then(() => process.exit(0)).catch(console.error);
