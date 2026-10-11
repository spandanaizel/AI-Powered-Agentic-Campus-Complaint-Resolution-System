import { Complaint, AgentRun } from '../models/index.js';
import { getProvider } from './providers/index.js';
import { ProviderError } from './providers/anthropic.js';
import { logger } from '../utils/logger.js';

// Shared by every agent: prompt framing, complaint loading, and the executor that calls the provider,
// validates output, falls back on any failure and records an AgentRun.

export const complaintBlock = (c) => `<complaint>
Title: ${c.title}
Category: ${c.category?.name ?? 'unknown'}
Location: ${c.location?.name ?? 'unknown'}
Description:
${c.description}
</complaint>`;

/**
 * Shared executor: calls the provider when configured, validates output, falls back on any failure,
 * and records an AgentRun (no prompt or complaint text is stored).
 */
export async function execute({ agent, task = null, complaintId, triggeredBy, callModel, fallback }) {
  const started = Date.now();
  const provider = getProvider();
  let output; let source; let status; let errorCategory = null;

  if (!provider) {
    output = fallback(); source = 'fallback'; status = 'fallback'; errorCategory = 'no_provider';
  } else {
    try {
      output = await callModel(provider);
      source = 'anthropic'; status = 'success';
    } catch (err) {
      errorCategory = err instanceof ProviderError ? err.category : 'internal';
      logger.warn('agent call failed; using fallback', { agent, complaintId: String(complaintId), errorCategory });
      output = fallback(); source = 'fallback'; status = 'fallback';
    }
  }
  await AgentRun.create({
    agent, task, complaint: complaintId, status, source,
    model: source === 'anthropic' ? provider.model : null,
    durationMs: Date.now() - started, errorCategory, triggeredBy: triggeredBy?._id ?? null,
  });
  return { output, source, model: source === 'anthropic' ? provider.model : null, errorCategory };
}

export async function loadComplaint(id) {
  return Complaint.findById(id).populate('category', 'name').populate('location', 'name');
}

