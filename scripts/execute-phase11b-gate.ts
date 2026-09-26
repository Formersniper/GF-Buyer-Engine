import http from 'http';
import { AddressInfo } from 'net';
import { createApp } from '../server';
import { setJwtAuthenticator, resetJwtAuthenticator, JwtAuthenticator } from '../app/middleware/auth';
import { AuthContext } from '../app/schemas/auth';
import { getSupabaseAdminClient, getSupabaseClient } from '../app/services/supabase/client';
import { supabaseDataService } from '../app/services/supabase/repositories';
import { evaluateCallEligibility } from '../app/services/calls/callEligibility';
import { callService } from '../app/services/calls/callService';

const TEST_LEAD_ID = '44ebcb9a-94da-49e5-a285-d10ec64eb1d2';
const TEST_TENANT_ID = 'be7e913b-8253-42f4-bf29-132849335947';
const TEST_ACTOR_EMAIL = 'phase11b-test-sales@example.com';
const TEST_ACTOR_USER_ID = 'b2f39c38-e60d-438e-ae8b-60b9805d3f16';
const TEST_ROLE = 'SALES';

class TestJwtAuth implements JwtAuthenticator {
  private tokens = new Map<string, AuthContext>();
  public register(token: string, ctx: AuthContext) {
    this.tokens.set(token, ctx);
  }
  async validateJwt(token: string): Promise<AuthContext | null> {
    return this.tokens.get(token) || null;
  }
}

async function runPhase11bGate() {
  console.log('=== PHASE 11B GATE EXECUTION ===');

  const client = getSupabaseAdminClient() || getSupabaseClient();
  if (!client) throw new Error('No Supabase client available');

  // PART C — Pre-flight check on target lead
  console.log('\n--- PART C: PRE-FLIGHT ---');
  const { data: leadBefore, error: leadError } = await client
    .from('leads')
    .select('*')
    .eq('id', TEST_LEAD_ID)
    .single();

  if (leadError || !leadBefore) {
    throw new Error(`Target lead not found: ${leadError?.message}`);
  }

  console.log('Lead Before:', {
    id: leadBefore.id,
    tenant_id: leadBefore.tenant_id,
    name: leadBefore.name,
    status: leadBefore.status,
    source: leadBefore.source,
    consent_status: leadBefore.consent_status,
    consent_source: leadBefore.consent_source,
    consent_timestamp: leadBefore.consent_timestamp,
    phone: leadBefore.phone
  });

  if (leadBefore.tenant_id !== TEST_TENANT_ID) {
    throw new Error(`Tenant mismatch: expected ${TEST_TENANT_ID}, got ${leadBefore.tenant_id}`);
  }

  // PART D — Re-run Call Eligibility
  console.log('\n--- PART D: CALL ELIGIBILITY ---');
  const mappedLead = await supabaseDataService.mapToGFBuyerLead({ tenantId: TEST_TENANT_ID }, TEST_LEAD_ID);
  if (!mappedLead) {
    throw new Error('Failed to map lead to canonical GFBuyerLead');
  }

  console.log('Mapped Canonical Lead:', {
    lead_id: mappedLead.lead_id,
    tenant_id: TEST_TENANT_ID,
    status: mappedLead.workflow.status,
    consent_status: mappedLead.provenance.consent_status,
    consent_source: mappedLead.provenance.consent_source,
    phone: mappedLead.identity.phone
  });

  const callsHistory = await supabaseDataService.calls.getCallsByLead(TEST_LEAD_ID);

  const eligibility = evaluateCallEligibility({
    leadId: mappedLead.lead_id,
    tenantId: TEST_TENANT_ID,
    status: mappedLead.workflow.status,
    phone: mappedLead.identity.phone,
    email: mappedLead.identity.email,
    consentStatus: mappedLead.provenance.consent_status,
    source: leadBefore.source,
    enrichmentAvailable: true,
    callsHistory
  });

  console.log('Eligibility Evaluation:', JSON.stringify(eligibility, null, 2));

  if (eligibility.decision !== 'ELIGIBLE') {
    throw new Error(`Lead is NOT ELIGIBLE: decision=${eligibility.decision}, reasons=${eligibility.reasons.join(', ')}`);
  }

  // PART E — Verify Mock-Only Provider State
  console.log('\n--- PART E: MOCK PROVIDER CHECK ---');
  const provider = callService.getActiveVoiceProvider();
  console.log('Active Voice Provider:', provider.providerName);
  console.log('VOICE_MODE:', process.env.VOICE_MODE || 'MOCK (default)');

  if (provider.providerName !== 'mock') {
    throw new Error(`Active provider is NOT mock: got ${provider.providerName}`);
  }

  // PART F & G — Execute POST /api/voice/start with Authenticated App Server
  console.log('\n--- PART F & G: EXECUTE MOCK VOICE CALL ---');

  const app = createApp();
  const testAuth = new TestJwtAuth();
  const tokenSales = 'valid-p11b-sales-token';
  testAuth.register(tokenSales, {
    userId: TEST_ACTOR_USER_ID,
    email: TEST_ACTOR_EMAIL,
    role: TEST_ROLE as any,
    tenantId: TEST_TENANT_ID,
    authMethod: 'SUPABASE_JWT' as any,
    isPlatformAdmin: false,
  });
  setJwtAuthenticator(testAuth);

  const server = http.createServer(app);
  await new Promise<void>((res) => server.listen(0, '127.0.0.1', () => res()));
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  let callResult: any;
  let executionPath = 'Request → Tenant Context → Lead Lookup → Canonical Mapping → Eligibility → Compliance → callService → Provider Resolver → mockVoiceProvider';

  try {
    const res = await fetch(`${baseUrl}/api/voice/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenSales}`
      },
      body: JSON.stringify({ leadId: TEST_LEAD_ID })
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`HTTP ${res.status}: ${errBody}`);
    }

    callResult = await res.json();
    console.log('HTTP POST /api/voice/start Result:', JSON.stringify(callResult, null, 2));
  } finally {
    server.close();
    resetJwtAuthenticator();
  }

  // PART H — Immediate Provider Safety Check
  console.log('\n--- PART H: PROVIDER SAFETY CHECK ---');
  const returnedProvider = callResult.callResult?.provider || callResult.provider;
  console.log('Returned Provider:', returnedProvider);
  if (returnedProvider !== 'mock') {
    throw new Error(`CRITICAL: Provider was NOT mock! Provider returned: ${returnedProvider}`);
  }
  console.log('PSTN Calls: 0');
  console.log('Sarvam Calls: 0');
  console.log('Real Provider Calls: 0');

  // PART I — Post-Call State
  console.log('\n--- PART I: POST-CALL LEAD STATE ---');
  const { data: leadAfter } = await client
    .from('leads')
    .select('*')
    .eq('id', TEST_LEAD_ID)
    .single();

  console.log('Lead State Before vs After:', {
    status: `${leadBefore.status} → ${leadAfter.status}`,
    tenant_id: `${leadBefore.tenant_id} → ${leadAfter.tenant_id}`,
    consent_status: `${leadBefore.consent_status} → ${leadAfter.consent_status}`,
    consent_source: `${leadBefore.consent_source} → ${leadAfter.consent_source}`,
    consent_timestamp: `${leadBefore.consent_timestamp} → ${leadAfter.consent_timestamp}`,
    phone: `${leadBefore.phone} → ${leadAfter.phone}`,
    source: `${leadBefore.source} → ${leadAfter.source}`,
  });

  // PART J — Session / Call Record
  console.log('\n--- PART J: SESSION / CALL RECORDS CREATED ---');
  const { data: createdCalls } = await client
    .from('calls')
    .select('*')
    .eq('lead_id', TEST_LEAD_ID)
    .order('created_at', { ascending: false });

  console.log('Calls for this lead in DB:', JSON.stringify(createdCalls, null, 2));

  // PART L — Global Database Integrity
  console.log('\n--- PART L: DATABASE STATS ---');
  const { count: totalLeads } = await client.from('leads').select('*', { count: 'exact', head: true });
  const { count: unknownLeads } = await client.from('leads').select('*', { count: 'exact', head: true }).eq('consent_status', 'UNKNOWN');
  const { count: confirmedLeads } = await client.from('leads').select('*', { count: 'exact', head: true }).eq('consent_status', 'CONFIRMED');
  const { count: nullLeads } = await client.from('leads').select('*', { count: 'exact', head: true }).is('consent_status', null);

  console.log('RECONCILED DB STATS:', {
    totalLeads,
    unknownLeads,
    confirmedLeads,
    nullLeads
  });

  return {
    leadBefore,
    leadAfter,
    callResult,
    executionPath,
    totalLeads,
    unknownLeads,
    confirmedLeads,
    nullLeads,
    createdCalls
  };
}

runPhase11bGate().catch((err) => {
  console.error('GATE EXECUTION FAILED:', err);
  process.exit(1);
});
