/**
 * GrowthForge Buyer Intelligence Engine - Phase 5F Broker Handoff Delivery Adapters
 *
 * Source of Truth: Formersniper/GF-Buyer-Engine
 * Defines provider-neutral delivery channel boundaries and safe mock implementation.
 *
 * SAFETY INVARIANT: Default operation is strictly MOCK / DRY-RUN.
 * No real WhatsApp, SMS, email, or third-party CRM modifications are executed.
 */

import { BrokerHandoffPackage, DispatchResult, BrokerDispatchStatus } from '../../../schemas/handoff';

export interface BrokerHandoffChannel {
  readonly channelName: string;
  dispatch(handoff: BrokerHandoffPackage, options?: { dryRun?: boolean }): Promise<DispatchResult>;
}

export class MockBrokerHandoffChannel implements BrokerHandoffChannel {
  public readonly channelName = 'MOCK_SALES_CHANNEL';
  private dispatchedPayloads: Map<string, { handoff: BrokerHandoffPackage; dispatchedAt: string }> = new Map();

  /**
   * Safe mock dispatch of sales handoff package.
   */
  public async dispatch(
    handoff: BrokerHandoffPackage,
    options: { dryRun?: boolean } = { dryRun: true }
  ): Promise<DispatchResult> {
    const isDryRun = options.dryRun !== false; // Default to true
    const now = new Date().toISOString();
    const dispatchId = `mock-dispatch-${Date.now()}-${handoff.handoff_id.slice(0, 8)}`;

    // Store in mock delivery registry
    this.dispatchedPayloads.set(handoff.handoff_id, {
      handoff,
      dispatchedAt: now,
    });

    return {
      success: true,
      dispatch_id: dispatchId,
      channel: this.channelName,
      status: 'SENT',
      delivered_at: now,
      dry_run: isDryRun,
      message: `[MOCK_DISPATCH_SUCCESS] Handoff ${handoff.handoff_id} safely dispatched to ${handoff.routing_decision.assigned_team} (${handoff.routing_decision.assigned_role}) with SLA ${handoff.routing_decision.sla_minutes}m. No real external side-effects produced.`,
    };
  }

  public getDispatchedHandoff(handoffId: string) {
    return this.dispatchedPayloads.get(handoffId) || null;
  }

  public clear() {
    this.dispatchedPayloads.clear();
  }
}

export const mockBrokerHandoffChannel = new MockBrokerHandoffChannel();
