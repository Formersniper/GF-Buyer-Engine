import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_ANON_KEY;
const client = createClient(url, key);

async function check() {
  const { data, error } = await client.rpc('version');
  console.log("RPC version:", data, error);
}

check();
