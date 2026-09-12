const fs = require('fs');
const path = require('path');
const p = 'app/services/voice/sarvamClient.ts';
let content = fs.readFileSync(p, 'utf8');

// 1. Add idempotencyKey to Payload
if (!content.includes('idempotencyKey?: string;')) {
  content = content.replace(
    "webhookUrl?: string;",
    "webhookUrl?: string;\n  idempotencyKey?: string;"
  );
}

// 2. Modify getHeaders
content = content.replace(
  "private getHeaders(): Record<string, string> {",
  "private getHeaders(idempotencyKey?: string): Record<string, string> {"
);
content = content.replace(
  "      'Content-Type': 'application/json',",
  "      'Content-Type': 'application/json',\n      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey, 'X-Idempotency-Key': idempotencyKey } : {}),"
);

// 3. Modify startOutboundCall
content = content.replace(
  "headers: this.getHeaders(),",
  "headers: this.getHeaders(payload.idempotencyKey || `sv-out-\${Date.now()}`),"
);
content = content.replace(
  "headers: this.getHeaders(),", // replace other occurrences
  "headers: this.getHeaders(),"
); // Wait, better just replace the one in startOutboundCall!

fs.writeFileSync(p, content);
console.log('Fixed sarvamClient');
