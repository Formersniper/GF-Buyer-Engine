const fs = require('fs');
const path = require('path');
const p = 'tests/security-external-services.spec.ts';
let content = fs.readFileSync(p, 'utf8');

content = content.replace(
  "process.env.NODE_ENV = 'production';",
  "process.env.NODE_ENV = 'production';\n    delete process.env.SUPABASE_URL;\n    delete process.env.SUPABASE_ANON_KEY;\n    delete process.env.VITE_SUPABASE_URL;\n    delete process.env.VITE_SUPABASE_ANON_KEY;\n    const clientModule = require('../app/services/supabase/client');\n    if(clientModule.resetSupabaseClient) clientModule.resetSupabaseClient();"
);
fs.writeFileSync(p, content);
console.log('Fixed test env');
