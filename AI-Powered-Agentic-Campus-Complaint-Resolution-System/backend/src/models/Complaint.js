import mongoose from 'mongoose';
import { STATUSES, PRIORITIES, PRIORITY_SOURCES, DEFAULT_PRIORITY, EVIDENCE_ASSESSMENTS } from '../config/constants.js';

const { ObjectId } = mongoose.Schema.Types;

const attachmentSchema = new mongoose.Schema(
  {
    storedName: { type: String, required: true },
    originalName: { type: String, required: true, maxlength: 200 },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
  },
  { _id: true, timestamps: { createdAt: true, updatedAt: false } },
);

// Outputs of the AI agents. `source` distinguishes model output from labelled fallbacks.
const aiSchema = new mongoose.Schema(
  {
    summary: {
      text: String, keyFacts: [String], categoryHint: String, limitations: String,
      source: { type: String, enum: ['anthropic', 'fallback'] }, model: String, generatedAt: Date,
    },
    priority: {
      predicted: { type: String, enum: PRIORITIES }, rationale: String, confidence: Number,
      source: { type: String, enum: ['anthropic', 'fallback'] }, model: String, generatedAt: Date,
    },
    resolution: {
      likelyCauses: [String],
      troubleshootingSteps: [{ _id: false, step: String, who: { type: String, enum: ['staff', 'specialist'] } }],
      possibleResolutions: [String], safetyNotes: [String], informationNeeded: [String], limitations: String,
      source: { type: String, enum: ['anthropic', 'fallback'] }, model: String, generatedAt: Date,
    },
    evidenceReview: {
      assessment: { type: String, enum: EVIDENCE_ASSESSMENTS },
      checks: [{ _id: false, item: String, status: { type: String, enum: ['present', 'missing', 'unclear'] }, note: String }],
      followUpQuestions: [String], limitations: String,
      // Always false: the review reads records; it cannot confirm that work was done.
      verified: { type: Boolean, default: false },
      resolutionNote: String, statusAtReview: String,
      source: { type: String, enum: ['anthropic', 'fallback'] }, model: String, generatedAt: Date,
      reviewedBy: { type: ObjectId, ref: 'User' },
    },
    assignment: {
      recommendedStaff: { type: ObjectId, ref: 'User' }, reason: String, applied: Boolean,
      source: { type: String, enum: ['anthropic', 'fallback'] }, model: String, generatedAt: Date,
    },
  },
  { _id: false },
);

const complaintSchema = new mongoose.Schema(
  {
    reporter: { type: ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true, maxlength: 150 },
    // Original student-submitted text. Never rewritten after creation.
    description: { type: String, required: true, trim: true, maxlength: 5000 },
    category: { type: ObjectId, ref: 'Category', required: true },
    location: { type: ObjectId, ref: 'Location', required: true },
    status: { type: String, enum: STATUSES, default: 'Submitted', required: true },
    priority: { type: String, enum: PRIORITIES, default: DEFAULT_PRIORITY, required: true },
    prioritySource: { type: String, enum: PRIORITY_SOURCES, default: 'default' },
    assignee: { type: ObjectId, ref: 'User', default: null },
    issueGroup: { type: ObjectId, ref: 'IssueGroup', default: null },
    groupGeneration: { type: Number, default: null },
    attachments: { type: [attachmentSchema], default: [] },
    ai: { type: aiSchema, default: () => ({}) },
    resolvedAt: Date,
    closedAt: Date,
  },
  { timestamps: true },
);

complaintSchema.index({ reporter: 1, createdAt: -1 });
complaintSchema.index({ assignee: 1, status: 1 });
complaintSchema.index({ status: 1, priority: 1, createdAt: -1 });
complaintSchema.index({ category: 1 });
complaintSchema.index({ issueGroup: 1, groupGeneration: 1 });

complaintSchema.set('toJSON', {
  transform(_doc, ret) {
    delete ret.__v;
    if (ret.attachments) ret.attachments = ret.attachments.map(({ storedName, ...a }) => a); // never expose disk names
    return ret;
  },
});

export const Complaint = mongoose.models.Complaint || mongoose.model('Complaint', complaintSchema);
