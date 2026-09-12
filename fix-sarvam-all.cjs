const fs = require('fs');
const path = require('path');
const p = 'app/services/voice/sarvamClient.ts';
let content = fs.readFileSync(p, 'utf8');

// replace globally all payload.idempotencyKey back to nothing
content = content.replace(/headers: this\.getHeaders\(payload\.idempotencyKey \|\| `sv-out-\$\{Date\.now\(\)\}`\)/g, "headers: this.getHeaders()");

// then ONLY replace inside startOutboundCall
const startOutbound = "async startOutboundCall(payload: SarvamOutboundPayload): Promise<SarvamOutboundResponse> {";
const split = content.split(startOutbound);
if (split.length === 2) {
  split[1] = split[1].replace(
    "headers: this.getHeaders(),",
    "headers: this.getHeaders(payload.idempotencyKey || `sv-out-\${Date.now()}`),"
  );
  content = split.join(startOutbound);
  fs.writeFileSync(p, content);
}
console.log('Fixed all sarvamClient');
