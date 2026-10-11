import mongoose from 'mongoose';
import { COMMENT_VISIBILITY } from '../config/constants.js';

const { ObjectId } = mongoose.Schema.Types;

const commentSchema = new mongoose.Schema(
  {
    complaint: { type: ObjectId, ref: 'Complaint', required: true },
    author: { type: ObjectId, ref: 'User', required: true },
    body: { type: String, required: true, trim: true, maxlength: 4000 },
    // 'public' = visible to the student; 'internal' = staff/admin notes only.
    visibility: { type: String, enum: COMMENT_VISIBILITY, required: true },
    // True when a staff member sent a message that started from an AI draft (after review).
    fromAiDraft: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
commentSchema.index({ complaint: 1, createdAt: 1 });

export const Comment = mongoose.models.Comment || mongoose.model('Comment', commentSchema);
