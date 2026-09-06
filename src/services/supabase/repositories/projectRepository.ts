/**
 * GrowthForge Project & ProjectMatch Repositories
 * 
 * Manages the controlled project catalog and buyer matches.
 */

import { getSupabaseClient } from '../client';
import { IProjectRepository, IProjectMatchRepository } from './interfaces';
import { ProjectRow, ProjectMatchRow } from './types';
import { Project, ProjectMatch } from '../../../types/buyerLead';
import { SAMPLE_PROJECTS } from '../../data/seedData';

class ProjectRepository implements IProjectRepository {
  private projects: Map<string, Project> = new Map();

  constructor() {
    SAMPLE_PROJECTS.forEach((p) => {
      this.projects.set(p.id, { ...p });
    });
  }

  async getAll(): Promise<Project[]> {
    const supabase = getSupabaseClient();
    if (supabase) {
      const { data, error } = await supabase.from('projects').select('*');
      if (!error && data) return data as Project[];
    }
    return Array.from(this.projects.values());
  }

  async getById(id: string): Promise<Project | null> {
    const supabase = getSupabaseClient();
    if (supabase) {
      const { data, error } = await supabase.from('projects').select('*').eq('id', id).single();
      if (!error && data) return data as Project;
    }
    return this.projects.get(id) || null;
  }

  async getByCode(code: string): Promise<Project | null> {
    for (const p of this.projects.values()) {
      if (p.project_code === code) return p;
    }
    return null;
  }

  async create(project: Omit<Project, 'id' | 'created_at' | 'updated_at'>): Promise<Project> {
    const now = new Date().toISOString();
    const newProject: Project = {
      ...project,
      id: `proj-${Date.now()}`,
      created_at: now,
      updated_at: now,
    };
    this.projects.set(newProject.id, newProject);
    return newProject;
  }
}

class ProjectMatchRepository implements IProjectMatchRepository {
  private matches: Map<string, ProjectMatch[]> = new Map();

  async getByLeadId(leadId: string): Promise<ProjectMatch[]> {
    return this.matches.get(leadId) || [];
  }

  async createMatches(matches: Omit<ProjectMatchRow, 'id' | 'created_at'>[]): Promise<ProjectMatchRow[]> {
    const now = new Date().toISOString();
    return matches.map((m) => ({
      ...m,
      id: `match-${Date.now()}-${Math.random()}`,
      created_at: now,
    }));
  }
}

export const projectRepository = new ProjectRepository();
export const projectMatchRepository = new ProjectMatchRepository();
