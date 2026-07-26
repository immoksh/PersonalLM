import { z } from 'zod';

export const googleSignInSchema = z.object({
  credential: z.string().min(16, 'Missing Google credential'),
});

export type GoogleSignInInput = z.infer<typeof googleSignInSchema>;

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  picture: string | null;
  createdAt: string;
}

export interface AuthResponse {
  user: PublicUser;
}

export function userInitials(user: Pick<PublicUser, 'name' | 'email'>): string {
  const source = user.name.trim() || user.email;
  const parts = source.split(/\s+/).filter(Boolean);

  if (parts.length >= 2) {
    return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}
