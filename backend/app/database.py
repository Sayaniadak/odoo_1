"""
HRMS Backend — Supabase Client Factory

Two clients, two purposes:

1. get_supabase_client(token)  — user-scoped, JWT passthrough.
   Every DB query runs through RLS as the calling user.
   This is the DEFAULT for all user-facing endpoints.

2. get_service_client()        — service-role, full access.
   Used ONLY for system operations: seeding, cron jobs,
   and admin functions that intentionally bypass RLS.
   Never exposed to user requests.
"""

from __future__ import annotations

from supabase import create_client, Client

from backend.app.config import settings


def get_supabase_client(token: str) -> Client:
    """
    Create a Supabase client scoped to the calling user's JWT.

    The client is initialised with the anon key, then the PostgREST
    Authorization header is overridden with the user's JWT.  This means
    every query goes through PostgREST → Postgres with RLS enforced
    against that user's auth.uid().

    The service-role key is NEVER used here.
    """
    client = create_client(settings.SUPABASE_URL, settings.SUPABASE_ANON_KEY)
    client.postgrest.auth(token)
    return client


def get_service_client() -> Client:
    """
    Create a Supabase client with service-role privileges.

    ⚠️  This client bypasses ALL RLS policies.
    Use ONLY for:
      • Seed scripts
      • pg_cron-style system operations
      • Admin operations that need cross-user writes
        (e.g. create_notification, create_audit_log — though
         those are better done via the SECURITY DEFINER SQL functions)
    """
    return create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_ROLE_KEY)
