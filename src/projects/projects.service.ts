import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { AuthUser } from '../auth/auth.types';
import { WorkspacePathService } from '../workspace/workspace-path.service';
import { Project, ProjectDocument } from './schemas/project.schema';

export interface ProjectView {
  id: string;
  name: string;
  workspacePath: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Projects, and the directories they point at.
 *
 * Two rules do the work here. A project belongs to one user, so it is always
 * looked up by id *and* userId — a project that is not yours reads as 404, the
 * same answer as one that never existed. And the path is never stored as
 * typed: WorkspacePathService resolves it against the allowlist first, so what
 * lands in the database is exactly what the sandbox will enforce.
 */
@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(
    @InjectModel(Project.name) private readonly projects: Model<ProjectDocument>,
    private readonly paths: WorkspacePathService,
  ) {}

  async create(user: AuthUser, name: string, workspacePath: string): Promise<ProjectView> {
    // Throws before anything is written if the path escapes the allowlist.
    const resolved = this.paths.resolveWithin(workspacePath);

    const userId = new Types.ObjectId(user.id);
    if (await this.projects.exists({ userId, workspacePath: resolved })) {
      throw new ConflictException('You already have a project for that directory');
    }

    const created = await this.projects.create({ userId, name: name.trim(), workspacePath: resolved });

    this.logger.log(`Project ${created._id.toString()} -> ${resolved}`);
    return this.toView(created);
  }

  async listForUser(user: AuthUser): Promise<ProjectView[]> {
    const found = await this.projects
      .find({ userId: new Types.ObjectId(user.id) })
      .sort({ updatedAt: -1 });

    return found.map((project) => this.toView(project));
  }

  async getForUser(user: AuthUser, id: string): Promise<ProjectView> {
    return this.toView(await this.requireOwned(user, id));
  }

  async rename(user: AuthUser, id: string, name: string): Promise<ProjectView> {
    const project = await this.requireOwned(user, id);
    project.name = name.trim();
    return this.toView(await project.save());
  }

  /** Removes the record. The directory on disk is left alone. */
  async remove(user: AuthUser, id: string): Promise<{ deleted: true }> {
    const project = await this.requireOwned(user, id);
    await project.deleteOne();

    this.logger.log(`Deleted project ${id}`);
    return { deleted: true };
  }

  /**
   * The directory a conversation should run in.
   *
   * With no project, the user gets their own private folder rather than a
   * shared one: workspace-write lets an agent read and write anywhere under
   * its cwd, so a common default would expose everyone's files to everyone.
   */
  async workspaceFor(user: AuthUser, projectId: string | null): Promise<string> {
    if (!projectId) return this.paths.personalWorkspace(user.id);

    const project = await this.requireOwned(user, projectId);

    // Re-checked on use, not just on creation: the allowlist may have been
    // narrowed, or the directory replaced by a link, since the project was
    // added.
    return this.paths.resolveWithin(project.workspacePath);
  }

  /** The single gate. Ownership cannot be skipped in one branch. */
  private async requireOwned(user: AuthUser, id: string): Promise<ProjectDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('No such project');
    }

    const found = await this.projects.findOne({
      _id: new Types.ObjectId(id),
      userId: new Types.ObjectId(user.id),
    });

    if (!found) throw new NotFoundException('No such project');
    return found;
  }

  private toView(project: ProjectDocument): ProjectView {
    return {
      id: project._id.toString(),
      name: project.name,
      workspacePath: project.workspacePath,
      createdAt: (project.get('createdAt') as Date | undefined)?.toISOString() ?? '',
      updatedAt: (project.get('updatedAt') as Date | undefined)?.toISOString() ?? '',
    };
  }
}
