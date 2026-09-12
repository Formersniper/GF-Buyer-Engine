const fs = require('fs');
const path = require('path');
const p = 'tests/security-external-services.spec.ts';
let content = fs.readFileSync(p, 'utf8');

content = content.replace(
  "delete process.env.VITE_SUPABASE_ANON_KEY;",
  "delete process.env.VITE_SUPABASE_ANON_KEY;\n    if (typeof import.meta !== 'undefined' && (import.meta).env) {\n      (import.meta).env.VITE_SUPABASE_URL = '';\n      (import.meta).env.SUPABASE_URL = '';\n      (import.meta).env.VITE_SUPABASE_ANON_KEY = '';\n      (import.meta).env.SUPABASE_ANON_KEY = '';\n    }"
);

// We need to import getSupabaseConfig or resetSupabaseClient statically
content = content.replace(
  "import { scoutAdapter } from '../app/services/scout/scoutAdapter';",
  "import { scoutAdapter } from '../app/services/scout/scoutAdapter';\nimport { resetSupabaseClient } from '../app/services/supabase/client';"
);

content = content.replace(
  "const clientModule = require('../app/services/supabase/client');",
  ""
);
content = content.replace(
  "if(clientModule.resetSupabaseClient) clientModule.resetSupabaseClient();",
  "resetSupabaseClient();"
);


fs.writeFileSync(p, content);
console.log('Fixed test 3');
