import mongoose from 'mongoose';

// Controlled list of campus locations. Together with Category it defines "the same issue".
const locationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);
locationSchema.index({ name: 1 }, { unique: true });

export const Location = mongoose.models.Location || mongoose.model('Location', locationSchema);
