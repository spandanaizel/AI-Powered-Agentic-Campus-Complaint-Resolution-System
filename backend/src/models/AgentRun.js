import mongoose from 'mongoose';
import { AGENT_RUN_NAMES, RESOLUTION_TASKS, AGENT_RUN_SOURCES } from '../config/constants.js';

// Troubleshooting/audit metadata for each agent execution. Prompts and complaint text are NOT stored.
const agentRunSchema = new mongoose.Schema(
  {
    agent: { type: String, enum: AGENT_RUN_NAMES, required: true },
    // For the resolution agent: which task ran (suggest | draft | evidence).
    task: { type: String, enum: [null, ...RESOLUTION_TASKS], default: null },
    complaint: { type: mongoose.Schema.Types.ObjectId, ref: 'Complaint', required: true },
    status: { type: String, enum: ['success', 'fallback', 'error'], required: true },
    source: { type: String, enum: AGENT_RUN_SOURCES, required: true },
    model: String,
    durationMs: Number,
    errorCategory: { type: String, enum: [null, 'no_provider', 'timeout', 'rate_limited', 'quota_exceeded', 'auth_error', 'provider_error', 'malformed_output', 'truncated', 'blocked', 'no_candidates', 'internal'], default: null },
    triggeredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
agentRunSchema.index({ complaint: 1, agent: 1, createdAt: -1 });

export const AgentRun = mongoose.models.AgentRun || mongoose.model('AgentRun', agentRunSchema);
