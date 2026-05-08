import type {
  Project,
  ProjectDetail,
  ProjectSummary,
  StemSummary,
} from './types';

export interface ProjectsRepo {
  list(): Promise<Project[]>;
  getById(id: string): Promise<Project>;
}

function summaryToProject(p: ProjectSummary): Project {
  return {
    id: p.id,
    title: p.name,
    folder: '',
    stems: [],
    driveFolderId: null,
  };
}

function detailToProject(detail: ProjectDetail, stems: StemSummary[]): Project {
  return {
    id: detail.id,
    title: detail.name,
    folder: '',
    stems: stems.map((s) => s.id),
    driveFolderId: detail.drive_folder_id,
  };
}

export class HttpProjectsRepo implements ProjectsRepo {
  constructor(private readonly bandId: string) {}

  async list(): Promise<Project[]> {
    const res = await fetch(
      `/api/projects?band_id=${encodeURIComponent(this.bandId)}`,
      { credentials: 'include' },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { projects: ProjectSummary[] };
    return data.projects.map(summaryToProject);
  }

  async getById(id: string): Promise<Project> {
    const res = await fetch(`/api/projects/${encodeURIComponent(id)}`, {
      credentials: 'include',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as {
      project: ProjectDetail;
      stems: StemSummary[];
    };
    return detailToProject(data.project, data.stems);
  }
}
