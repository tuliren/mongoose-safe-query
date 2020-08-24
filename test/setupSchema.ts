import mongoose from 'mongoose';
import { safeQueryPlugin } from './setupPlugin';

const projectSchema = new mongoose.Schema({
  name: String,
  createdAt: String,
  updatedAt: String,
  priority: Number,
  active: Boolean,
  config: new mongoose.Schema({
    premium: Boolean,
    version: Number,
  }, { _id: false }),
});

projectSchema.index({ createdAt: 1 });
projectSchema.index({ name: 1 });

projectSchema.plugin(safeQueryPlugin);

export const Project = mongoose.model('project', projectSchema);
