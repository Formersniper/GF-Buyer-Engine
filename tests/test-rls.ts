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

interface ScenarioResult {
  scenarioNumber: number;
  description: string;
  tenantIdInJwt: any;
  expectedResult: string;
  passed: boolean;
  actualCount?: number;
  errorMsg?: string;
  unhandledException: boolean;
}

async function runTests() {
  console.log("============================================================");
  console.log("GROWTHFORGE REAL-WORLD RLS SECURITY INTEGRATION TEST SUITE");
  console.log("============================================================\n");

  const results: ScenarioResult[] = [];

  const runId = Math.floor(Math.random() * 100000);
  const tenantA = "32b2a654-be8c-4a3d-b2a3-f0fa8b2a1a01";
  const tenantB = "32b2a654-be8c-4a3d-b2a3-f0fa8b2a1b02";
  const tenantC_upper = "32B2A654-BE8C-4A3D-B2A3-F0FA8B2A1C03";

  const leadA = "aaaaae2e-a111-4a3d-b2a3-f0fa8b2a1111";
  const leadC = "aaaaae2e-c333-4a3d-b2a3-f0fa8b2a3333";

  const handoffA = "b1111111-1111-4111-b111-111111111111";
  const handoffC = "b3333333-3333-4333-b333-333333333333";

  const emailPattern = `rls-user-${runId}`;
  const password = "RLSSecurePassword2026!";

  const createdUserIds: string[] = [];

  try {
    console.log("Setup: Ensuring clean start for test IDs...");
    await adminClient.from('broker_handoffs').delete().in('id', [handoffA, handoffC]);
    await adminClient.from('leads').delete().in('id', [leadA, leadC]);
    await adminClient.from('tenants').delete().in('id', [tenantA, tenantB, tenantC_upper.toLowerCase()]);

    console.log("Setup: Creating live tenants...");
    await adminClient.from('tenants').insert([
      { id: tenantA, name: `Tenant Alpha ${runId}`, slug: `tenant-alpha-${runId}` },
      { id: tenantB, name: `Tenant Beta ${runId}`, slug: `tenant-beta-${runId}` },
      { id: tenantC_upper.toLowerCase(), name: `Tenant Gamma ${runId}`, slug: `tenant-gamma-${runId}` }
    ]);

    console.log("Setup: Creating leads...");
    await adminClient.from('leads').insert([
      { id: leadA, tenant_id: tenantA, lead_id: `LEAD-RLS-A-${runId}`, name: 'Lead A', status: 'HANDOFF' },
      { id: leadC, tenant_id: tenantC_upper.toLowerCase(), lead_id: `LEAD-RLS-C-${runId}`, name: 'Lead C', status: 'HANDOFF' }
    ]);

    console.log("Setup: Creating broker handoffs...");
    await adminClient.from('broker_handoffs').insert([
      {
        id: handoffA,
        lead_id: leadA,
        tenant_id: tenantA,
        handoff_status: 'READY',
        routing_status: 'ROUTED',
        priority_tier: 'HIGH',
        sla_minutes: 60,
        sla_deadline: new Date(Date.now() + 3600000).toISOString(),
        dispatch_status: 'PENDING'
      },
      {
        id: handoffC,
        lead_id: leadC,
        tenant_id: tenantC_upper.toLowerCase(),
        handoff_status: 'READY',
        routing_status: 'ROUTED',
        priority_tier: 'HIGH',
        sla_minutes: 60,
        sla_deadline: new Date(Date.now() + 3600000).toISOString(),
        dispatch_status: 'PENDING'
      }
    ]);

    console.log("Setup: Database test entries verified.");

    const scenarios = [
      { num: 1, desc: "Valid Tenant A (Lowercase)", jwtTenantId: tenantA, expected: "Allowed (Returns Row)" },
      { num: 2, desc: "Tenant B / Cross-Tenant Isolation", jwtTenantId: tenantB, expected: "Denied (Empty Result)" },
      { num: 3, desc: "Missing tenant_id claim", jwtTenantId: undefined, expected: "Denied (Empty Result / Fail Closed)" },
      { num: 4, desc: "tenant_id = 'null' claim", jwtTenantId: "null", expected: "Denied (Empty Result / Fail Closed)" },
      { num: 5, desc: "tenant_id = 'not-a-uuid' claim", jwtTenantId: "not-a-uuid", expected: "Denied (Empty Result / Fail Closed)" },
      { num: 6, desc: "tenant_id = '12345' claim", jwtTenantId: "12345", expected: "Denied (Empty Result / Fail Closed)" },
      { num: 7, desc: "Uppercase valid UUID", jwtTenantId: tenantC_upper, expected: "Allowed (Returns Row / Case Insensitive)" }
    ];

    for (const sc of scenarios) {
      console.log(`\n------------------------------------------------------------`);
      console.log(`Executing Scenario ${sc.num}: ${sc.desc}`);
      console.log(`------------------------------------------------------------`);

      const email = `${emailPattern}-sc${sc.num}@example.com`;
      const appMetadata = sc.jwtTenantId !== undefined ? { tenant_id: sc.jwtTenantId } : {};

      console.log(`Creating user for Scenario ${sc.num} with app_metadata:`, appMetadata);
      const { data: uData, error: uError } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        app_metadata: appMetadata
      });

      if (uError || !uData?.user) {
        console.error(`Failed to create user for Scenario ${sc.num}:`, uError?.message);
        results.push({
          scenarioNumber: sc.num,
          description: sc.desc,
          tenantIdInJwt: sc.jwtTenantId,
          expectedResult: sc.expected,
          passed: false,
          errorMsg: `User creation failed: ${uError?.message}`,
          unhandledException: false
        });
        continue;
      }

      const uid = uData.user.id;
      createdUserIds.push(uid);

      if (sc.jwtTenantId && sc.jwtTenantId !== "null" && sc.jwtTenantId !== "not-a-uuid" && sc.jwtTenantId !== "12345") {
        console.log("Setting up database membership...");
        await adminClient.from('tenant_memberships').upsert({
          tenant_id: sc.jwtTenantId.toLowerCase(),
          user_id: uid,
          role: 'ADMIN'
        });
      }

      console.log("Signing in with user password to fetch genuine user JWT...");
      const authClient = createClient(url, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false }
      });

      const { data: sData, error: sError } = await authClient.auth.signInWithPassword({
        email,
        password
      });

      if (sError || !sData?.session) {
        console.error(`Sign in failed: ${sError?.message}`);
        results.push({
          scenarioNumber: sc.num,
          description: sc.desc,
          tenantIdInJwt: sc.jwtTenantId,
          expectedResult: sc.expected,
          passed: false,
          errorMsg: `Sign in failed: ${sError?.message}`,
          unhandledException: false
        });
        continue;
      }

      const token = sData.session.access_token;
      
      // Build a genuine, non-service-role client using the obtained JWT
      const authenticatedClient = createClient(url, anonKey, {
        global: {
          headers: {
            Authorization: `Bearer ${token}`
          }
        },
        auth: { persistSession: false, autoRefreshToken: false }
      });

      console.log("Quering broker_handoffs table using the authenticated client...");
      
      let actualCount = 0;
      let errorMsg = undefined;
      let unhandledException = false;

      try {
        const { data, error } = await authenticatedClient.from('broker_handoffs').select('*');
        if (error) {
          errorMsg = error.message;
          unhandledException = true;
          console.error("Query returned error:", error.message);
        } else {
          actualCount = data ? data.length : 0;
          console.log(`Query succeeded. Row count: ${actualCount}`);
        }
      } catch (ex: any) {
        unhandledException = true;
        errorMsg = ex.message;
        console.error("Unhandled Query Exception caught:", ex.message);
      }

      // Verification logic
      let passed = false;
      if (!unhandledException) {
        if (sc.num === 1) {
          passed = (actualCount > 0);
        } else if (sc.num === 2) {
          passed = (actualCount === 0);
        } else if (sc.num === 3) {
          passed = (actualCount === 0);
        } else if (sc.num === 4) {
          passed = (actualCount === 0);
        } else if (sc.num === 5) {
          passed = (actualCount === 0);
        } else if (sc.num === 6) {
          passed = (actualCount === 0);
        } else if (sc.num === 7) {
          passed = (actualCount > 0);
        }
      }

      results.push({
        scenarioNumber: sc.num,
        description: sc.desc,
        tenantIdInJwt: sc.jwtTenantId,
        expectedResult: sc.expected,
        passed,
        actualCount,
        errorMsg,
        unhandledException
      });

      console.log(`Scenario ${sc.num} result: ${passed ? "✅ PASS" : "❌ FAIL"}`);
    }

  } catch (globalError: any) {
    console.error("Global Test execution error:", globalError);
  } finally {
    console.log("\n====================================================");
    console.log("CLEANING UP RESOURCES...");
    console.log("====================================================");

    for (const uid of createdUserIds) {
      console.log(`Deleting auth user: ${uid}`);
      await adminClient.auth.admin.deleteUser(uid).catch(e => console.error("Error deleting user:", e));
    }

    console.log("Deleting database test entries...");
    await adminClient.from('broker_handoffs').delete().in('id', [handoffA, handoffC]);
    await adminClient.from('leads').delete().in('id', [leadA, leadC]);
    await adminClient.from('tenants').delete().in('id', [tenantA, tenantB, tenantC_upper.toLowerCase()]);

    console.log("\n====================================================");
    console.log("FINAL REPORT SCENARIO VERIFICATION RESULTS");
    console.log("====================================================");

    let allPassed = true;
    for (const res of results) {
      console.log(`\nScenario ${res.scenarioNumber}: ${res.description}`);
      console.log(`  - JWT Tenant ID Claim  : ${res.tenantIdInJwt}`);
      console.log(`  - Expected Outcome     : ${res.expectedResult}`);
      console.log(`  - Actual Row Count     : ${res.actualCount !== undefined ? res.actualCount : 'N/A'}`);
      console.log(`  - Unhandled Exception  : ${res.unhandledException ? "YES ❌" : "NO ✅"}`);
      if (res.errorMsg) console.log(`  - Error Message        : ${res.errorMsg}`);
      console.log(`  - Verdict              : ${res.passed ? "PASS ✅" : "FAIL ❌"}`);
      if (!res.passed) allPassed = false;
    }

    console.log("\n====================================================");
    console.log(`CONCLUSION: ${allPassed ? "🎉 ALL 7 SCENARIOS PASSED PERFECTLY!" : "❌ SOME SCENARIOS FAILED"}`);
    console.log("====================================================");

    process.exit(allPassed ? 0 : 1);
  }
}

runTests().catch(err => {
  console.error("Uncaught running script:", err);
  process.exit(1);
});
