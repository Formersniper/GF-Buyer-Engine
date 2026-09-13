import { config } from 'dotenv';
config();

import { supabaseDataService as dataService } from '../app/services/supabase/repositories';
import { brokerHandoffService } from '../app/services/handoff/brokerHandoffService';
import { CRMRouter } from '../app/services/handoff/crmRouter';
import { BrokerHandoffPackage } from '../app/schemas/handoff';

async function runTests() {
  console.log('--- RUNNING PHASE 8B.3 TESTS: CRM DISPATCH ENGINE ---\n');
  

  const tenantId = '00000000-0000-0000-0000-000000000001';
  const tenantScope = { tenantId, isPlatformAdmin: true };
  
  console.log('1. Creating Mock Lead & Handoff...');
  const hId = `11111111-0000-0000-0000-${String(Date.now()).slice(0, 12)}`;
  const leadId = `00000000-0000-0000-0000-${String(Date.now()).slice(0, 12)}`;
  await dataService.leads.createLead(tenantScope, {
    id: leadId,
    tenant_id: tenantId,
    lead_id: `EXT-${leadId}`,
    name: 'CRM Test Buyer',
    phone: '+919999999999',
    status: 'NEW',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  } as any);

  const savedHandoff = await dataService.brokerHandoffs.createHandoff({
    id: hId,
    lead_id: leadId,
    tenant_id: tenantId,
    handoff_status: 'READY',
    routing_status: 'ASSIGNED',
    dispatch_status: 'PENDING',
    handoff_payload: { handoff_id: hId, routing_decision: { assigned_team: "Team A" } } as unknown as BrokerHandoffPackage,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  } as any);

  console.log("Saved Handoff:", savedHandoff);
  console.log('2. Configuring CRM Destination...');
  const config = await dataService.crmConfigs.createConfig(tenantScope, {
    provider_name: 'TestCRM',
    destination_type: 'MOCK_SALES_CHANNEL',
    endpoint_url: 'https://api.testcrm.example.com',
    is_enabled: true,
    dry_run_mode: true,
    metadata: {}
  });
  console.log(`Config Created: ${config.id} - ${config.provider_name} (Dry-Run)`);
  
  console.log('\n3. Dispatching Handoff (Dry-Run Mode)...');
  const res1 = await brokerHandoffService.dispatchHandoff(hId, { dryRun: false }); // Should be overridden to dry-run by config
  console.log('Dispatch 1 Result:', res1);
  if (res1.channel !== 'TestCRM') {
    throw new Error('Dispatch channel was not overridden by CRM Config');
  }

  console.log('\n4. Disabling Dry-Run on Config...');
  await dataService.crmConfigs.updateConfig(tenantScope, config.id, { dry_run_mode: false });
  
  console.log('\n5. Dispatching Handoff again (Duplicate Check)...');
  const res2 = await brokerHandoffService.dispatchHandoff(hId, { dryRun: false });
  console.log('Dispatch 2 Result (Idempotency):', res2);
  if (res2.status !== 'IGNORED_DUPLICATE') {
    throw new Error('Idempotency check failed - duplicate not ignored.');
  }
  
  console.log('\n6. Force Redispatch (Live)...');
  const res3 = await brokerHandoffService.dispatchHandoff(hId, { dryRun: false, forceRedispatch: true });
  console.log('Dispatch 3 Result:', res3);
  if (res3.dry_run) {
    throw new Error('Should be a LIVE dispatch but was marked as dry_run');
  }

  console.log('\n--- PHASE 8B.3 TESTS PASSED ---');
}

runTests().catch(console.error);
