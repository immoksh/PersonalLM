import { OAuth2Client } from 'google-auth-library';
import { env } from '../config/env.js';
import { ApiError } from './ApiError.js';

export interface GoogleIdentity {
  /** Google's stable, immutable user id. The account key — never the email. */
  sub: string;
  email: string;
  name: string;
  picture: string | null;
}

let client: OAuth2Client | null = null;

function getClient(): OAuth2Client {
  if (!env.GOOGLE_CLIENT_ID) {
    // A missing client id means the audience check cannot happen, and an
    // unchecked audience accepts tokens minted for any other Google app.
    throw ApiError.internal('Google sign-in is not configured on the server');
  }
  client ??= new OAuth2Client(env.GOOGLE_CLIENT_ID);
  return client;
}

/**
 * Verifies a Google ID token. The library checks the RS256 signature against
 * Google's published keys, the issuer, the audience and the expiry — so a
 * forged or replayed token is rejected here rather than trusted downstream.
 */
export async function verifyGoogleCredential(credential: string): Promise<GoogleIdentity> {
  const ticket = await getClient()
    .verifyIdToken({ idToken: credential, audience: env.GOOGLE_CLIENT_ID! })
    .catch(() => {
      throw ApiError.unauthorized('Could not verify that Google sign-in, please try again');
    });

  const payload = ticket.getPayload();
  if (!payload?.sub || !payload.email) {
    throw ApiError.unauthorized('That Google account did not provide an email address');
  }

  // An unverified address could belong to someone else; treating it as an
  // identity would let an attacker claim another person's account.
  if (payload.email_verified === false) {
    throw ApiError.forbidden('Verify your email address with Google before signing in');
  }

  return {
    sub: payload.sub,
    email: payload.email,
    name: payload.name?.trim() || payload.email.split('@')[0] || 'User',
    picture: payload.picture ?? null,
  };
}
