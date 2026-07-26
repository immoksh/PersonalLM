import { randomUUID } from 'node:crypto';
import type { PublicUser } from '@personallm/shared';
import { db } from '../../db/index.js';
import type { GoogleIdentity } from '../../utils/googleAuth.js';

interface UserRow {
  id: string;
  name: string;
  email: string;
  google_sub: string | null;
  picture: string | null;
  created_at: string;
}

const toPublicUser = (row: UserRow): PublicUser => ({
  id: row.id,
  name: row.name,
  email: row.email,
  picture: row.picture,
  createdAt: row.created_at,
});

const SELECT_COLUMNS = 'id, name, email, google_sub, picture, created_at';

const selectById = db.prepare<[string]>(`SELECT ${SELECT_COLUMNS} FROM users WHERE id = ?`);
const selectBySub = db.prepare<[string]>(`SELECT ${SELECT_COLUMNS} FROM users WHERE google_sub = ?`);
const selectByEmail = db.prepare<[string]>(`SELECT ${SELECT_COLUMNS} FROM users WHERE email = ?`);

/**
 * `password_hash` is vestigial: migration 001 declared it NOT NULL, and SQLite
 * cannot drop a NOT NULL constraint in place. Nothing reads it — there is no
 * password login — so new rows get an empty string. It disappears with the
 * move to PostgreSQL.
 */
const insertUser = db.prepare(
  `INSERT INTO users (id, name, email, google_sub, picture, password_hash, created_at)
   VALUES (@id, @name, @email, @google_sub, @picture, '', @created_at)`,
);

const updateProfile = db.prepare(
  `UPDATE users SET name = @name, email = @email, picture = @picture, google_sub = @google_sub
   WHERE id = @id`,
);

export function findUserById(id: string): PublicUser | null {
  const row = selectById.get(id) as UserRow | undefined;
  return row ? toPublicUser(row) : null;
}

/**
 * Finds or creates the local account behind a verified Google identity, and
 * refreshes the cached name/picture so profile edits on Google show up here.
 *
 * Matching is by `sub` first: Google account emails can change, but `sub` never
 * does, so email is only a fallback for linking a pre-existing row.
 */
export function upsertGoogleUser(identity: GoogleIdentity): PublicUser {
  const link = db.transaction((): UserRow => {
    const existing =
      (selectBySub.get(identity.sub) as UserRow | undefined) ??
      (selectByEmail.get(identity.email) as UserRow | undefined);

    if (existing) {
      const updated: UserRow = {
        ...existing,
        name: identity.name,
        email: identity.email,
        picture: identity.picture,
        google_sub: identity.sub,
      };
      updateProfile.run(updated);
      return updated;
    }

    const created: UserRow = {
      id: randomUUID(),
      name: identity.name,
      email: identity.email,
      google_sub: identity.sub,
      picture: identity.picture,
      created_at: new Date().toISOString(),
    };
    insertUser.run(created);
    return created;
  });

  return toPublicUser(link());
}
