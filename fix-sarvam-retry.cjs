const fs = require('fs');
const path = require('path');
const p = 'app/services/voice/sarvamVoiceProvider.ts';
let content = fs.readFileSync(p, 'utf8');

// add imports
if (!content.includes('import { withRetry, withTimeout }')) {
  content = content.replace(
    "import { buildSarvamSystemPrompt",
    "import { withRetry, withTimeout } from '../errors';\nimport { buildSarvamSystemPrompt"
  );
}

// wrap the client call
const origCall = `    // 1. Dispatch outbound call to Sarvam Client
    // If systemPrompt is not explicitly passed, leave undefined so Sarvam uses the dashboard v2 "Growthforge Sales" Shubh agent configuration
    const outboundResult = await this.client.startOutboundCall({
      toPhoneNumber: lead.phone,
      leadId: lead.lead_id,
      webhookUrl: process.env.APP_URL ? \`\${process.env.APP_URL}/api/voice/sarvam/webhook\` : undefined,
      customVariables: {
        lead_id: lead.lead_id,
        tenant_id: lead.tenant_id,
        first_name: lead.name?.split(' ')[0] || 'Sir/Madam',
      },
    });`;

const newCall = `    // 1. Dispatch outbound call to Sarvam Client
    // Generate idempotency key for this call attempt
    const idempotencyKey = \`sv-out-\${lead.lead_id}-\${Date.now()}\`;
    
    const outboundResult = await withRetry(
      () => withTimeout(
        this.client.startOutboundCall({
          toPhoneNumber: lead.phone,
          leadId: lead.lead_id,
          idempotencyKey,
          webhookUrl: process.env.APP_URL ? \`\${process.env.APP_URL}/api/voice/sarvam/webhook\` : undefined,
          customVariables: {
            lead_id: lead.lead_id,
            tenant_id: lead.tenant_id,
            first_name: lead.name?.split(' ')[0] || 'Sir/Madam',
          },
        }),
        15000,
        'Sarvam'
      ),
      {
        provider: 'Sarvam',
        maxAttempts: 3,
        baseDelayMs: 2000,
        shouldRetry: (err) => {
          if (err?.code === SarvamErrorCode.RATE_LIMITED) return true;
          if (err?.code === SarvamErrorCode.TIMEOUT) return true;
          if (err?.code === SarvamErrorCode.PROVIDER_ERROR) return true;
          return false;
        }
      }
    );`;

if (content.includes("await this.client.startOutboundCall")) {
  content = content.replace(origCall, newCall);
  fs.writeFileSync(p, content);
  console.log('Fixed sarvamVoiceProvider retry');
}

