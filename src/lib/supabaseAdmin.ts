import 'server-only';

import { createClient } from '@supabase/supabase-js';

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `[supabase] Missing required env var ${name}. Set it in Vercel + local .env`
    );
  }
  return value;
}

export function getSupabaseAdmin() {
  const url = requiredEnv('SUPABASE_URL');
  const serviceRoleKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY');

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function getTaskAttachmentsBucket() {
  return process.env.SUPABASE_STORAGE_BUCKET_TASK_ATTACHMENTS || 'task-attachments';
}

export function getClientDocumentsBucket() {
  return process.env.SUPABASE_STORAGE_BUCKET_CLIENT_DOCUMENTS || 'client-documents';
}

export function getSignedUrlExpirySeconds() {
  const raw = process.env.SUPABASE_SIGNED_URL_TTL_SECONDS;
  const parsed = raw ? Number(raw) : 60 * 10;
  if (!Number.isFinite(parsed) || parsed <= 0) return 60 * 10;
  return parsed;
}

