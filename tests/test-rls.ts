import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceKey) {
  console.error("Missing credentials. URL:", !!url, "AnonKey:", !!anonKey, "ServiceKey:", !!serviceKey);
  process.exit(1);
}

const adminClient = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

async function runTests() {
  console.log("============================================================");
  console.log("STARTING REAL SUPABASE RLS VERIFICATION");
  console.log("============================================================\n");

  const email = `rls-test-${Date.now()}@example.com`;
  const password = "RLSTestPassword123!";
  const tenantA = "11111111-1111-1111-1111-111111111111";
  const tenantB = "22222222-2222-2222-2222-222222222222";

  console.log("Step 1: Creating test tenants...");
  await adminClient.from('tenants').upsert([
    { id: tenantA, name: "Tenant Alpha", slug: `tenant-alpha-${Date.now()}` },
    { id: tenantB, name: "Tenant Beta", slug: `tenant-beta-${Date.now()}` }
  ]);

  console.log("Step 2: Creating auth user with custom app_metadata...");
  const { data: userData, error: userError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: {
      tenant_id: tenantA
    }
  });

  if (userError || !userData?.user) {
    console.error("Failed to create auth user:", userError);
    process.exit(1);
  }

  const userId = userData.user.id;
  console.log(`User created. ID: ${userId}`);

  console.log("Step 3: Creating tenant membership in DB...");
  const { error: memberError } = await adminClient.from('tenant_memberships').insert({
    tenant_id: tenantA,
    user_id: userId,
    role: 'ADMIN'
  });

  if (memberError) {
    console.error("Failed to create tenant membership:", memberError);
    process.exit(1);
  }

  console.log("Step 4: Signing in as the new user...");
  const authClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: sessionData, error: signInError } = await authClient.auth.signInWithPassword({
    email,
    password
  });

  if (signInError || !sessionData?.session) {
    console.error("Failed to sign in:", signInError);
    process.exit(1);
  }

  const userJwt = sessionData.session.access_token;
  console.log("Successfully signed in and obtained a genuine user JWT.");

  // Create standard authenticated, non-service-role client
  const authenticatedClient = createClient(url, anonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${userJwt}`
      }
    },
    auth: { persistSession: false, autoRefreshToken: false }
  });

  console.log("\n====================================================");
  console.log("TESTING RLS ACCESS...");
  console.log("====================================================");

  // Insert a dummy lead and a broker_handoff for testing
  const leadIdA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const handoffIdA = "aaaa-aaaa-aaaa-aaaa"; // Wait, broker_handoffs.id is UUID
  const handoffIdA_uuid = "a1111111-1111-1111-1111-111111111111";
  
  console.log("Step 5: Inserting test records belonging to Tenant A...");
  await adminClient.from('leads').upsert({
    id: leadIdA,
    tenant_id: tenantA,
    lead_id: `GF-RLS-A`,
    status: 'HANDOFF',
    name: 'Lead Tenant A'
  });

  const { error: handoffInsertError } = await adminClient.from('broker_handoffs').upsert({
    id: handoffIdA_uuid,
    lead_id: leadIdA,
    tenant_id: tenantA,
    handoff_status: 'READY',
    routing_status: 'ROUTED',
    priority_tier: 'HIGH',
    sla_minutes: 60,
    sla_deadline: new Date(Date.now() + 3600000).toISOString(),
    dispatch_status: 'PENDING'
  });

  if (handoffInsertError) {
    console.error("Failed to insert broker handoff:", handoffInsertError);
  } else {
    console.log("Test handoff for Tenant A successfully inserted.");
  }

  // TEST 1: Retrieve Tenant A Handoff
  console.log("\n--- TEST 1: VALID TENANT A ---");
  const { data: data1, error: err1 } = await authenticatedClient.from('broker_handoffs').select('*');
  console.log("Result:", { count: data1?.length, error: err1?.message });
  if (data1 && data1.length > 0) {
    console.log("✅ TEST 1 PASSED: Handoffs correctly accessible for Tenant A.");
  } else {
    console.error("❌ TEST 1 FAILED: Expected handoffs but got none.");
  }

  // Clean up user
  console.log("\nCleaning up auth user...");
  await adminClient.auth.admin.deleteUser(userId);
  console.log("All tasks completed.");
}

runTests().catch(err => {
  console.error("Fatal error:", err);
});
