import type {
  Practice,
  PracticeDetail,
  PracticeSummary,
  StemSummary,
} from './types';

export interface PracticesRepo {
  list(): Promise<Practice[]>;
  getById(id: string): Promise<Practice>;
}

function summaryToPractice(p: PracticeSummary): Practice {
  return {
    id: p.id,
    title: p.name,
    folder: '',
    stems: [],
    stemCount: p.stem_count,
    driveFolderId: p.drive_folder_id,
    referenceStemId: p.reference_stem_id,
  };
}

function detailToPractice(detail: PracticeDetail, stems: StemSummary[]): Practice {
  // Reference stem fallback: name match → first stem by position → null.
  // Must mirror `findPracticesForBandWithRefStem` in src/server/db.ts so the
  // detail and list endpoints agree on which stem the picker thumbnail uses.
  const refName = detail.reference_stem;
  const refId = refName
    ? stems.find((s) => s.name === refName)?.id ?? stems[0]?.id ?? null
    : stems[0]?.id ?? null;
  return {
    id: detail.id,
    title: detail.name,
    folder: '',
    stems: stems.map((s) => s.id),
    stemCount: stems.length,
    driveFolderId: detail.drive_folder_id,
    referenceStemId: refId,
  };
}

export class HttpPracticesRepo implements PracticesRepo {
  constructor(private readonly bandId: string) {}

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
}
