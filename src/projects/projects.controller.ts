import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';

import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { ProjectView, ProjectsService } from './projects.service';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<ProjectView[]> {
    return this.projects.listForUser(user);
  }

  /** The path is validated against the allowlist before anything is stored. */
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateProjectDto): Promise<ProjectView> {
    return this.projects.create(user, dto.name, dto.workspacePath);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<ProjectView> {
    return this.projects.getForUser(user, id);
  }

  @Patch(':id')
  rename(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateProjectDto,
  ): Promise<ProjectView> {
    return this.projects.rename(user, id, dto.name);
  }

  /** Removes the record only; the directory on disk is untouched. */
  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<{ deleted: true }> {
    return this.projects.remove(user, id);
  }
}
