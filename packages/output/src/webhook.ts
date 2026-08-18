/**
 * Webhook Emitter (§2, §6 Phase 4).
 *
 *   "the plug-and-play surface. A fleet's existing TMS calls this or
 *    subscribes to it; you are not asking anyone to adopt a new siloed app."
 *   "Build it as a real, documented webhook contract even though nothing
 *    external consumes it yet."
 *
 * Fires once per AgentDecision — that is the pipeline's actual conclusion,
 * the point a real TMS would want to react to, carrying the full chain (the
 * event and both evaluator outputs) that produced it so a subscriber doesn't
 * have to make three separate calls back to reconstruct context.
 *
 * `version` is on the payload from day one specifically because nothing
 * consumes this yet — a contract with no version field cannot change later
 * without silently breaking whoever eventually subscribes.
 */

import type {
  AgentDecision,
  CargoRiskAssessment,
  ComplianceRecord,
  ThermalExposureEvent,
} from '@threshold/types';

export const WEBHOOK_CONTRACT_VERSION = '1' as const;

export interface ThresholdWebhookPayload {
  event: 'agent_decision';
  version: typeof WEBHOOK_CONTRACT_VERSION;
  thermal_event: ThermalExposureEvent;
  compliance_record: ComplianceRecord;
  cargo_assessment: CargoRiskAssessment;
  decision: AgentDecision;
  delivered_at: string;
}

export interface WebhookDeliveryResult {
  delivered: boolean;
  status?: number;
  error?: string;
}

export interface WebhookEmitter {
  emit(payload: ThresholdWebhookPayload): Promise<WebhookDeliveryResult>;
}

export function buildWebhookPayload(input: {
  thermal_event: ThermalExposureEvent;
  compliance_record: ComplianceRecord;
  cargo_assessment: CargoRiskAssessment;
  decision: AgentDecision;
  now?: () => Date;
}): ThresholdWebhookPayload {
  const now = input.now ?? (() => new Date());
  return {
    event: 'agent_decision',
    version: WEBHOOK_CONTRACT_VERSION,
    thermal_event: input.thermal_event,
    compliance_record: input.compliance_record,
    cargo_assessment: input.cargo_assessment,
    decision: input.decision,
    delivered_at: now().toISOString(),
  };
}

/**
 * Real HTTP delivery. With no `url` configured, `emit` is a documented no-op
 * — "nothing external consumes it yet" made literal, not faked. The contract
 * still exists and is still exercised (see `buildWebhookPayload` and its
 * tests); there's simply nowhere to POST it.
 */
export class HttpWebhookEmitter implements WebhookEmitter {
  constructor(
    private readonly url: string | null,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async emit(payload: ThresholdWebhookPayload): Promise<WebhookDeliveryResult> {
    if (!this.url) {
      return { delivered: false, error: 'no webhook URL configured — documented no-op' };
    }
    try {
      const response = await this.fetchImpl(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return { delivered: response.ok, status: response.status };
    } catch (error) {
      return { delivered: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

/** Records every payload instead of sending it. For tests and local demo runs. */
export class RecordingWebhookEmitter implements WebhookEmitter {
  readonly deliveries: ThresholdWebhookPayload[] = [];

  emit(payload: ThresholdWebhookPayload): Promise<WebhookDeliveryResult> {
    this.deliveries.push(payload);
    return Promise.resolve({ delivered: true, status: 200 });
  }
}
