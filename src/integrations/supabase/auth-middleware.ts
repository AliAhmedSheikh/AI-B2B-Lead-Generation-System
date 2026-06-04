import { createMiddleware } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { createClient } from '@supabase/supabase-js'
import type { Database } from './types'

/**
 * Decode a JWT payload without verifying the signature.
 * Security: RLS on Supabase enforces auth — the DB rejects invalid tokens.
 * We only need the sub (userId) here to pass into context.
 */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1];
    // Base64url → Base64 → JSON
    const padded = payload.replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(padded);
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export const requireSupabaseAuth = createMiddleware({ type: 'function' }).server(
  async ({ next }) => {

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;

    if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
      const missing = [
        ...(!SUPABASE_URL ? ['SUPABASE_URL'] : []),
        ...(!SUPABASE_PUBLISHABLE_KEY ? ['SUPABASE_PUBLISHABLE_KEY'] : []),
      ];
      const message = `Missing Supabase environment variable(s): ${missing.join(', ')}. Check your .env file.`;
      console.error(`[Supabase] ${message}`);
      throw new Error(message);
    }

    const request = getRequest();

    if (!request?.headers) {
      throw new Error('Unauthorized: No request headers available');
    }

    const authHeader = request.headers.get('authorization');

    if (!authHeader) {
      throw new Error('Unauthorized: No authorization header provided');
    }

    if (!authHeader.startsWith('Bearer ')) {
      throw new Error('Unauthorized: Only Bearer tokens are supported');
    }

    const token = authHeader.replace('Bearer ', '').trim();
    if (!token) {
      throw new Error('Unauthorized: No token provided');
    }

    // Decode JWT locally to extract userId — no network call needed.
    // Supabase RLS validates the token cryptographically on every DB query.
    const payload = decodeJwtPayload(token);
    if (!payload) {
      throw new Error('Unauthorized: Malformed token');
    }

    const userId = payload.sub as string | undefined;
    if (!userId) {
      throw new Error('Unauthorized: No user ID found in token');
    }

    // Check token expiry
    const exp = payload.exp as number | undefined;
    if (exp && Date.now() / 1000 > exp) {
      throw new Error('Unauthorized: Token has expired');
    }

    // Build a Supabase client scoped to this user's JWT — RLS uses this token
    const supabase = createClient<Database>(
      SUPABASE_URL,
      SUPABASE_PUBLISHABLE_KEY,
      {
        global: {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
        auth: {
          storage: undefined,
          persistSession: false,
          autoRefreshToken: false,
        },
      }
    );

    return next({
      context: {
        supabase,
        userId,
        claims: payload,
      },
    });
  },
);
