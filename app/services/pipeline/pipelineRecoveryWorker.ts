import { supabaseDataService } from '../supabase/repositories';
import { buyerPipelineCoordinator } from './buyerPipelineCoordinator';
import { logger } from '../security/logger';
import { generateUUID } from '../supabase/repos/helpers';

export interface PipelineRecoveryWorkerOptions {
  pollingIntervalMs: number;
  leaseDurationMs: number;
  maxAttempts: number;
}

export class PipelineRecoveryWorker {
  private isRunning = false;
  private workerId: string;
  private intervalId: NodeJS.Timeout | null = null;
  private options: PipelineRecoveryWorkerOptions;

  constructor(options?: Partial<PipelineRecoveryWorkerOptions>) {
    this.workerId = `worker-${generateUUID()}`;
    this.options = {
      pollingIntervalMs: options?.pollingIntervalMs || 5000,
      leaseDurationMs: options?.leaseDurationMs || 300000, // 5 minutes default
      maxAttempts: options?.maxAttempts || 3
    };
  }

  public start() {
    if (this.isRunning) return;
    this.isRunning = true;
    logger.info(`Starting PipelineRecoveryWorker (ID: ${this.workerId})`, {
      service: 'PipelineRecoveryWorker',
      data: { workerId: this.workerId }
    });
    this.poll();
  }

  public stop() {
    this.isRunning = false;
    if (this.intervalId) {
      clearTimeout(this.intervalId);
      this.intervalId = null;
    }
    logger.info(`Stopped PipelineRecoveryWorker (ID: ${this.workerId})`, {
      service: 'PipelineRecoveryWorker',
      data: { workerId: this.workerId }
    });
  }

  private async poll() {
    if (!this.isRunning) return;
    try {
      await this.processNextExecution();
    } catch (err: any) {
      logger.error('Worker polling error', {
        service: 'PipelineRecoveryWorker',
        error_category: 'WORKER_ERROR',
        data: { error: err.message }
      });
    } finally {
      if (this.isRunning) {
        this.intervalId = setTimeout(() => this.poll(), this.options.pollingIntervalMs);
      }
    }
  }

  private async processNextExecution() {
    // Attempt atomic claim
    const execution = await supabaseDataService.pipelineExecutions.claimExecution(
      this.workerId,
      this.options.leaseDurationMs,
      this.options.maxAttempts
    );

    if (!execution) {
      return; // Nothing to process
    }

    const { id: executionId, lease_token: leaseToken, tenant_id: tenantId } = execution;

    if (!leaseToken || !tenantId) {
      logger.error('Claimed execution missing lease_token or tenant_id', {
        service: 'PipelineRecoveryWorker',
        data: { executionId }
      });
      return;
    }

    logger.info(`Claimed execution ${executionId}`, {
      service: 'PipelineRecoveryWorker',
      data: {
        executionId,
        workerId: this.workerId,
        attemptCount: execution.attempt_count
      }
    });

    try {
      // Invoke coordinator using authoritative tenant scope
      const scope = { tenantId, isPlatformAdmin: false };
      
      const result = await buyerPipelineCoordinator.runPipeline({
        executionId,
        leadId: execution.lead_id,
        callId: execution.call_id || undefined,
        tenantId: tenantId,
        forceRerun: false
      });

      if (result.success) {
        // Complete execution using lease fencing
        await supabaseDataService.pipelineExecutions.updateExecutionWithFencing(
          scope,
          executionId,
          leaseToken,
          {
            status: 'COMPLETED',
            completed_at: new Date().toISOString()
          }
        );
      } else {
        await this.handleFailure(scope, executionId, leaseToken, execution.attempt_count, result.error);
      }
    } catch (err: any) {
      const scope = { tenantId, isPlatformAdmin: false };
      await this.handleFailure(scope, executionId, leaseToken, execution.attempt_count, err.message);
    }
  }

  private async handleFailure(scope: {tenantId: string, isPlatformAdmin: boolean}, executionId: string, leaseToken: string, currentAttemptCount: number, errorMsg?: string) {
    if (currentAttemptCount >= this.options.maxAttempts) {
      // Terminal failure
      await supabaseDataService.pipelineExecutions.updateExecutionWithFencing(
        scope,
        executionId,
        leaseToken,
        {
          status: 'FAILED',
          last_error: errorMsg || 'Terminal failure',
          completed_at: new Date().toISOString()
        }
      );
    } else {
      // Transient failure -> retry
      // Backoff: 30s * attempt count
      const backoffMs = 30000 * currentAttemptCount;
      const nextAttemptAt = new Date(Date.now() + backoffMs).toISOString();
      await supabaseDataService.pipelineExecutions.updateExecutionWithFencing(
        scope,
        executionId,
        leaseToken,
        {
          status: 'PENDING',
          last_error: errorMsg || 'Transient failure',
          next_attempt_at: nextAttemptAt
        }
      );
    }
  }
}

export const pipelineRecoveryWorker = new PipelineRecoveryWorker();
