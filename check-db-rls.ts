import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  console.log("Missing credentials.");
  process.exit(1);
}

const client = createClient(url, key);

async function check() {
  console.log("Testing Anon INSERT...");
  const { data: insData, error: insErr } = await client.from('webhook_events').insert({
    event_id: 'test-event-rls-1',
    provider: 'test',
    status: 'PENDING'
  }).select();
  console.log("Insert result:", { data: insData, error: insErr });

  console.log("Testing Anon SELECT...");
  const { data: selData, error: selErr } = await client.from('webhook_events').select('*');
  console.log("Select result:", { data: selData, error: selErr });
}

check();
