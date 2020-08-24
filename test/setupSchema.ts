import mongoose from 'mongoose';
import { safeQueryPlugin } from './setupPlugin';

const projectSchema = new mongoose.Schema({
  name: String,
  createdAt: String,
  updatedAt: String,
  active: Boolean,
  // This field will show as priority.value and
  // priority.legacy in Schema.paths
  priority: {
    value: String,
    legacy: Boolean,
  },
  // This field will show as config in Schema.paths
  config: new mongoose.Schema({
    premium: Boolean,
    version: Number,
  }, { _id: false }),
});

projectSchema.index({ createdAt: 1 });
projectSchema.index({ name: 1 });

projectSchema.plugin(safeQueryPlugin);

export const Project = mongoose.model('project', projectSchema);
