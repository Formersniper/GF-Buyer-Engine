const fs = require('fs');
const path = require('path');

const reposDir = 'app/services/supabase/repos';
const files = fs.readdirSync(reposDir).filter(f => f.endsWith('.ts') && f !== 'helpers.ts');

for (const file of files) {
  const p = path.join(reposDir, file);
  let content = fs.readFileSync(p, 'utf8');
  
  // Fix commented-out closing brace
  content = content.replace(/catch \{\s*\/\/\s*ignore and fallback\s*\}/g, "catch { /* ignore and fallback */ }");

  fs.writeFileSync(p, content);
}
console.log('Fixed');
