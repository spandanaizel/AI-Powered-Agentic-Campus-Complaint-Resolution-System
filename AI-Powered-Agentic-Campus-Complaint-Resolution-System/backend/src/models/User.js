import mongoose from 'mongoose';
import { ROLES } from '../config/constants.js';

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
    // Never selected by default; never serialized.
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, default: 'student', required: true },
    active: { type: Boolean, default: true },
    // Staff only: categories this staff member can be assigned to.
    categories: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Category' }],
    maxOpenAssignments: { type: Number, default: 10, min: 1, max: 500 },
    // Incremented on logout / role change / deactivation to invalidate existing tokens.
    tokenVersion: { type: Number, default: 0 },
  },
  { timestamps: true },
);

userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ role: 1, active: 1 });

userSchema.set('toJSON', {
  transform(_doc, ret) {
    delete ret.passwordHash;
    delete ret.tokenVersion;
    delete ret.__v;
    return ret;
  },
});

export const User = mongoose.models.User || mongoose.model('User', userSchema);
