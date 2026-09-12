const fs = require('fs');
const path = require('path');

const reposDir = 'app/services/supabase/repos';
const files = fs.readdirSync(reposDir).filter(f => f.endsWith('.ts') && f !== 'helpers.ts');

for (const file of files) {
  const p = path.join(reposDir, file);
  let content = fs.readFileSync(p, 'utf8');
  
  // Revert imports
  content = content.replace(/import \{ checkProductionFallback, ([^}]+)\} from '\.\/helpers';/, "import { $1 } from './helpers';");

  // Revert catch
  content = content.replace(/catch \(e\) \{ checkProductionFallback\('read_fallback', e\); \}/g, "catch { // ignore and fallback }");

  // Revert write fallbacks
  content = content.replace(/checkProductionFallback\('write_fallback'\);\n\s+([a-zA-Z]+Store)\.set\(/g, "console.warn(`[Supabase Fallback] Schema cache pending...`);\n              $1.set(");

  // Revert the mangled stuff
  // we have `(checkProductionFallback('in_memory_store'), someStore` -> `someStore`
  content = content.replace(/\(checkProductionFallback\('in_memory_store'\),\s*([a-zA-Z0-9_]+Store)/g, "$1");
  
  // Also we had `/* check_prod */ checkProductionFallback('in_memory_store');` 
  content = content.replace(/\/\*\s*check_prod\s*\*\/\s*checkProductionFallback\('in_memory_store'\);\s*/g, "");

  // check if there's any bare checkProductionFallback left
  content = content.replace(/checkProductionFallback\('in_memory_store'\);\s*/g, "");

  // We had some cases where I missed a closing paren? `leadsStore.get(id);` where there was a `(` before. But I just removed `(checkProductionFallback..., `. Let's see if we have unbalanced parens.
  // Actually, wait, the replacement `(check... , store` -> `store` will leave `store.get(...)` alone.
  
  fs.writeFileSync(p, content);
}
console.log('Reverted');
