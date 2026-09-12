const fs = require('fs');
const path = require('path');
const p = 'app/services/voice/sarvamClient.ts';
let content = fs.readFileSync(p, 'utf8');

// In getCallTelemetry, replace headers: this.getHeaders(...) back to headers: this.getHeaders(),
// But ONLY inside getCallTelemetry. We can just replace the specific block.
const origBlock = `async getCallTelemetry(externalCallId: string): Promise<SarvamCallTelemetry> {
    this.ensureConfigured();
    const endpointUrl = \`\${this.baseUrl}/api/outbounds/v1/orgs/\${this.orgId}/workspaces/\${this.workspaceId}/outbounds/\${encodeURIComponent(externalCallId)}\`;
    try {
      const response = await fetch(endpointUrl, {
        method: 'GET',
        headers: this.getHeaders(payload.idempotencyKey || \`sv-out-\${Date.now()}\`),`;

const newBlock = `async getCallTelemetry(externalCallId: string): Promise<SarvamCallTelemetry> {
    this.ensureConfigured();
    const endpointUrl = \`\${this.baseUrl}/api/outbounds/v1/orgs/\${this.orgId}/workspaces/\${this.workspaceId}/outbounds/\${encodeURIComponent(externalCallId)}\`;
    try {
      const response = await fetch(endpointUrl, {
        method: 'GET',
        headers: this.getHeaders(),`;

content = content.replace(origBlock, newBlock);

fs.writeFileSync(p, content);
console.log('Fixed telemetry headers');
