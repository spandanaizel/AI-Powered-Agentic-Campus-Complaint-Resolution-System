import mongoose from 'mongoose';

const categorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    description: { type: String, trim: true, maxlength: 300, default: '' },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);
categorySchema.index({ name: 1 }, { unique: true });

export const Category = mongoose.models.Category || mongoose.model('Category', categorySchema);
