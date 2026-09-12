import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_ANON_KEY;
const client = createClient(url, key);

async function check() {
  const { data, error } = await client.from('webhook_events').select('*').limit(1);
  console.log("SELECT webhook_events:", error ? error.message : "Success");
}
check();
