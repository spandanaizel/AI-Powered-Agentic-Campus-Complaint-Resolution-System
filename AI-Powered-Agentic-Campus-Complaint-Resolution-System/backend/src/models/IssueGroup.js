import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;

// One document per (category, location) issue key. Reporter counting and the escalation decision
// live in IssueReporter / IssueEscalation, whose UNIQUE indexes make them safe under concurrency.
const issueGroupSchema = new mongoose.Schema(
  {
    groupKey: { type: String, required: true },
    category: { type: ObjectId, ref: 'Category', required: true },
    location: { type: ObjectId, ref: 'Location', required: true },
    generation: { type: Number, default: 1 },
    windowStartedAt: { type: Date, required: true },
    // Denormalized view of IssueEscalation for the current generation (set by the single escalator).
    escalated: { type: Boolean, default: false },
    escalatedAt: Date,
    escalationThreshold: Number,
    resolvedGenerations: [{ _id: false, generation: Number, reporterCount: Number, escalated: Boolean, closedAt: Date, closedBy: ObjectId, reason: String }],
  },
  { timestamps: true },
);
issueGroupSchema.index({ groupKey: 1 }, { unique: true });
issueGroupSchema.index({ escalated: 1, updatedAt: -1 });
issueGroupSchema.set('toJSON', { transform(_d, ret) { delete ret.__v; return ret; } });

export const IssueGroup = mongoose.models.IssueGroup || mongoose.model('IssueGroup', issueGroupSchema);

// One row per distinct reporter of a group generation. The unique index is the guarantee that a
// student is counted once, even when several submissions race.
const issueReporterSchema = new mongoose.Schema(
  {
    issueGroup: { type: ObjectId, ref: 'IssueGroup', required: true },
    generation: { type: Number, required: true },
    reporter: { type: ObjectId, ref: 'User', required: true },
    firstComplaint: { type: ObjectId, ref: 'Complaint', required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
issueReporterSchema.index({ issueGroup: 1, generation: 1, reporter: 1 }, { unique: true });
export const IssueReporter = mongoose.models.IssueReporter || mongoose.model('IssueReporter', issueReporterSchema);

// At most one row per group generation: the unique insert IS the exactly-once escalation transition.
const issueEscalationSchema = new mongoose.Schema(
  {
    issueGroup: { type: ObjectId, ref: 'IssueGroup', required: true },
    generation: { type: Number, required: true },
    reporterCount: { type: Number, required: true },
    threshold: { type: Number, required: true },
    triggeredBy: { type: ObjectId, ref: 'Complaint', required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
issueEscalationSchema.index({ issueGroup: 1, generation: 1 }, { unique: true });
export const IssueEscalation = mongoose.models.IssueEscalation || mongoose.model('IssueEscalation', issueEscalationSchema);
