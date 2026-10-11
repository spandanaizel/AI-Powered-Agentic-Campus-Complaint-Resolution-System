import mongoose from 'mongoose';

const { ObjectId, Mixed } = mongoose.Schema.Types;

// Append-only audit log. Update/delete operations are blocked at the model layer.
const auditSchema = new mongoose.Schema(
  {
    actor: { type: ObjectId, ref: 'User', default: null },
    actorType: { type: String, enum: ['user', 'system', 'agent'], required: true },
    action: { type: String, required: true },
    resourceType: { type: String, required: true },
    resourceId: { type: ObjectId, required: true },
    from: Mixed,
    to: Mixed,
    reason: { type: String, maxlength: 1000 },
    // Whether a student who owns the complaint may see this event in their timeline.
    studentVisible: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
auditSchema.index({ resourceType: 1, resourceId: 1, createdAt: 1 });

function blockMutation() {
  throw new Error('Audit events are append-only');
}
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndDelete']) {
  auditSchema.pre(op, blockMutation);
}

export const AuditEvent = mongoose.models.AuditEvent || mongoose.model('AuditEvent', auditSchema);
