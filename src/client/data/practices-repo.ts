import type {
  Practice,
  PracticeDetail,
  PracticeSummary,
  StemSummary,
  TrashList,
} from './types';

export interface PracticesRepo {
  list(): Promise<Practice[]>;
  getById(id: string): Promise<Practice>;
  renamePractice(id: string, name: string): Promise<void>;
  deletePractice(id: string): Promise<void>;
  restorePractice(id: string): Promise<void>;
  renameStem(id: string, name: string): Promise<void>;
  deleteStem(id: string): Promise<void>;
  restoreStem(id: string): Promise<void>;
  listTrash(): Promise<TrashList>;
}

function summaryToPractice(p: PracticeSummary): Practice {
  return {
    id: p.id,
    title: p.name,
    folder: '',
    stems: [],
    stemCount: p.stem_count,
    driveFolderId: p.drive_folder_id,
    referenceStemId: p.reference_stem_id ?? null,
  };
}

function detailToPractice(detail: PracticeDetail, stems: StemSummary[]): Practice {
  // Picker thumbnail uses the first stem (by position). Mirrors the list
  // endpoint's `reference_stem_id` so detail and list views agree.
  const refId = stems[0]?.id ?? null;
  return {
    id: detail.id,
    title: detail.name,
    folder: '',
    stems: stems.map((s) => ({ id: s.id, name: s.name })),
    stemCount: stems.length,
    driveFolderId: detail.drive_folder_id,
    referenceStemId: refId,
  };
}

export class HttpPracticesRepo implements PracticesRepo {
  private readonly bandId: string;

  constructor(bandId: string) {
    this.bandId = bandId;
  }

  async list(): Promise<Practice[]> {
    const res = await fetch(
      `/api/practices?band_id=${encodeURIComponent(this.bandId)}`,
      { credentials: 'include' },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { practices: PracticeSummary[] };
    return data.practices.map(summaryToPractice);
  }

  async getById(id: string): Promise<Practice> {
    const res = await fetch(`/api/practices/${encodeURIComponent(id)}`, {
      credentials: 'include',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as {
      practice: PracticeDetail;
      stems: StemSummary[];
    };
    return detailToPractice(data.practice, data.stems);
  }

  async renamePractice(id: string, name: string): Promise<void> {
    const res = await fetch(`/api/practices/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }

  async deletePractice(id: string): Promise<void> {
    const res = await fetch(`/api/practices/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }

  async restorePractice(id: string): Promise<void> {
    const res = await fetch(`/api/practices/${encodeURIComponent(id)}/restore`, {
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
