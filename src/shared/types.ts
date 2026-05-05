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
