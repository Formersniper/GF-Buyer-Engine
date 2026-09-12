const fs = require('fs');
const path = require('path');

const reposDir = 'app/services/supabase/repos';
const files = fs.readdirSync(reposDir).filter(f => f.endsWith('.ts') && f !== 'helpers.ts');

for (const file of files) {
  const p = path.join(reposDir, file);
  let content = fs.readFileSync(p, 'utf8');
  
  content = content.replace(/checkProductionFallback\('write_fallback'\);\n\s+/g, "");

  fs.writeFileSync(p, content);
}
console.log('Fixed leftovers');
