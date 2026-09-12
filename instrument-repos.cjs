const fs = require('fs');
const path = require('path');

const reposDir = 'app/services/supabase/repos';
const files = fs.readdirSync(reposDir).filter(f => f.endsWith('.ts') && f !== 'helpers.ts');

for (const file of files) {
  const p = path.join(reposDir, file);
  let content = fs.readFileSync(p, 'utf8');
  
  // add import if not exists
  if (!content.includes('checkProductionFallback')) {
    content = content.replace(/import \{([^}]+)\} from '\.\/helpers';/, "import { checkProductionFallback, $1 } from './helpers';");
  }

  // Replace "// ignore and fallback" with "checkProductionFallback('query', error); // fallback"
  // Actually, sometimes it's `catch { // ignore and fallback }` -> we need to change to `catch (e) { checkProductionFallback('query', e); }`
  content = content.replace(/catch\s*\{\s*\/\/\s*ignore and fallback\s*\}/g, "catch (e) { checkProductionFallback('read_fallback', e); }");
  content = content.replace(/catch\s*\(e\)\s*\{\s*\/\/\s*ignore and fallback\s*\}/g, "catch (e) { checkProductionFallback('read_fallback', e); }");

  // Replace "console.warn(`[Supabase Fallback] Schema cache pending" with checkProductionFallback
  content = content.replace(/console\.warn\(\`\[Supabase Fallback\].*?\);\s*([a-zA-Z]+Store)\.set\(/g, "checkProductionFallback('write_fallback');\n              $1.set(");

  // In write operations, if client is missing, we just fall through to Store.set
  // Look for `if (client) { ... } \n  someStore.set(`
  // It's safer to just look for `Store.set(` and `Store.get(` and `Store.values(` and `Store.delete(` and inject `checkProductionFallback('store_access');` right before it.
  
  content = content.replace(/([a-zA-Z0-9_]+Store\.(set|get|has|delete|values)\()/g, "/* check_prod */ checkProductionFallback('in_memory_store');\n      return $1".replace("return $1", "$1"));

  // fix any `return /* check_prod */` that might have happened if it was inline
  content = content.replace(/return\s+\/\* check_prod \*\/\s+checkProductionFallback\('in_memory_store'\);\s+([a-zA-Z0-9_]+Store)/g, "checkProductionFallback('in_memory_store');\n      return $1");

  content = content.replace(/=\s+\/\* check_prod \*\/\s+checkProductionFallback\('in_memory_store'\);\s+([a-zA-Z0-9_]+Store)/g, "= (checkProductionFallback('in_memory_store'), $1");

  // some return cases:
  // return leadsStore.get(id) || null;
  // -> checkProductionFallback('in_memory_store'); return leadsStore.get(id) || null;

  fs.writeFileSync(p, content);
}
console.log('Repos instrumented');
