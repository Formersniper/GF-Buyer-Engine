const fs = require('fs');
const path = require('path');
const p = 'tests/security-external-services.spec.ts';
let content = fs.readFileSync(p, 'utf8');

content = content.replace(
  "import { describe, it, expect, beforeEach, afterEach } from 'vitest';",
  "import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';\n\nvi.mock('../app/services/supabase/client', () => ({\n  getSupabaseClient: () => null,\n  resetSupabaseClient: () => {}\n}));"
);

fs.writeFileSync(p, content);
console.log('Fixed test mock');
