const fs = require('fs');
const path = require('path');
const p = 'tests/security-external-services.spec.ts';
let content = fs.readFileSync(p, 'utf8');

content = content.replace(
  "await expect(repo.leads.getLead('test-id')).rejects.toThrow",
  "await expect(repo.leads.getLead({ isPlatformAdmin: true }, 'test-id')).rejects.toThrow"
);
fs.writeFileSync(p, content);
console.log('Fixed test');
