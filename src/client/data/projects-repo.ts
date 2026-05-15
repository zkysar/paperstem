import type {
  Project,
  ProjectDetail,
  ProjectSummary,
  StemSummary,
  TrashList,
} from './types';

export interface ProjectsRepo {
  list(): Promise<Project[]>;
  getById(id: string): Promise<Project>;
  renameProject(id: string, name: string): Promise<void>;
  deleteProject(id: string): Promise<void>;
  restoreProject(id: string): Promise<void>;
  renameStem(id: string, name: string): Promise<void>;
  deleteStem(id: string): Promise<void>;
  restoreStem(id: string): Promise<void>;
  listTrash(): Promise<TrashList>;
}

function summaryToProject(p: ProjectSummary): Project {
  return {
    id: p.id,
    title: p.name,
    folder: '',
    stems: [],
    stemCount: p.stem_count,
    folderId: p.folder_id,
    referenceStemId: p.reference_stem_id ?? null,
    updatedAt: p.updated_at,
  };
}

function detailToProject(detail: ProjectDetail, stems: StemSummary[]): Project {
  // Picker thumbnail uses the first stem (by position). Mirrors the list
  // endpoint's `reference_stem_id` so detail and list views agree.
  const refId = stems[0]?.id ?? null;
  return {
    id: detail.id,
    title: detail.name,
    folder: '',
    stems: stems.map((s) => ({ id: s.id, name: s.name, peaks: s.peaks })),
    stemCount: stems.length,
    folderId: detail.folder_id,
    referenceStemId: refId,
    updatedAt: detail.updated_at,
  };
}

export class HttpProjectsRepo implements ProjectsRepo {
  private readonly bandId: string;

  constructor(bandId: string) {
    this.bandId = bandId;
  }

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

  async renameProject(id: string, name: string): Promise<void> {
    const res = await fetch(`/api/projects/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }

  async deleteProject(id: string): Promise<void> {
    const res = await fetch(`/api/projects/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }

  async restoreProject(id: string): Promise<void> {
    const res = await fetch(`/api/projects/${encodeURIComponent(id)}/restore`, {
      method: 'POST',
      credentials: 'include',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }

  async renameStem(id: string, name: string): Promise<void> {
    const res = await fetch(`/api/stems/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }

  async deleteStem(id: string): Promise<void> {
    const res = await fetch(`/api/stems/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }

  async restoreStem(id: string): Promise<void> {
    const res = await fetch(`/api/stems/${encodeURIComponent(id)}/restore`, {
      method: 'POST',
      credentials: 'include',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }

  async listTrash(): Promise<TrashList> {
    const res = await fetch(`/api/bands/${encodeURIComponent(this.bandId)}/trash`, {
      credentials: 'include',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as TrashList;
  }
}
