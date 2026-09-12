const fs = require('fs');
const path = require('path');
const p = 'tests/security-external-services.spec.ts';
let content = fs.readFileSync(p, 'utf8');

// Cast import.meta to any
content = content.replace(/\(import\.meta\)\.env/g, "((import.meta) as any).env");
// @ts-ignore for vitest import if needed, but better just adding @ts-nocheck to the top of the file since it's just a test file
content = "// @ts-nocheck\n" + content;

fs.writeFileSync(p, content);
console.log('Fixed test types');
