import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ProjectDocument = HydratedDocument<Project>;

/**
 * A directory a user has chosen to work in.
 *
 * `workspacePath` is stored canonical — symlinks resolved, `..` collapsed —
 * because that is the form the sandbox enforces against. Storing what the user
 * typed would let the stored value and the enforced value disagree.
 */
@Schema({ timestamps: true, collection: 'projects' })
export class Project {
  @Prop({ required: true, type: Types.ObjectId, ref: 'User', index: true })
  userId!: Types.ObjectId;

  @Prop({ required: true, trim: true, maxlength: 120 })
  name!: string;

  @Prop({ required: true })
  workspacePath!: string;
}

export const ProjectSchema = SchemaFactory.createForClass(Project);

ProjectSchema.index({ userId: 1, updatedAt: -1 });
// One project per directory per user; two rows for the same folder are noise.
ProjectSchema.index({ userId: 1, workspacePath: 1 }, { unique: true });
