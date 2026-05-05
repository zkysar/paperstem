export type User = {
  id: string;
  email: string;
  display_name: string | null;
};

export type Session = {
  id: string;
  user_id: string;
  expires_at: number;
  created_at: number;
};

export type BandRole = 'owner' | 'member';

export type Band = {
  id: string;
  name: string;
  drive_folder_id: string;
  owner_user_id: string;
  created_at: number;
};

export type BandWithRole = Band & { role: BandRole };

export type BandMember = {
  id: string;
  email: string;
  display_name: string | null;
  role: BandRole;
};
