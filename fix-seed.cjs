const fs = require('fs');
const path = require('path');
const p = 'app/services/supabase/repositories.ts';
let content = fs.readFileSync(p, 'utf8');

content = content.replace(
  "private seedDefaultData(): void {",
  "private seedDefaultData(): void {\n    if (process.env.NODE_ENV === 'production') return;"
);
fs.writeFileSync(p, content);
console.log('Fixed seedDefaultData');
