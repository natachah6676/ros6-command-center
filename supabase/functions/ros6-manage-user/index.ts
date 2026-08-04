/**
 * Edge Function optionnelle — définition directe d’un mot de passe par le R5.
 *
 * Déploiement (CLI) :
 *   supabase functions deploy ros6-manage-user --no-verify-jwt=false
 *
 * Secrets : SUPABASE_SERVICE_ROLE_KEY (injecté automatiquement sur Supabase Hosted)
 *
 * Corps JSON :
 *   { "action": "set_password", "email": "...", "password": "..." }
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  try {
    const authHeader = req.headers.get('Authorization') || '';
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ ok: false, error: 'Non authentifié' }), {
        status: 401,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const { data: isR5, error: r5Error } = await userClient.rpc('ros6_is_active_r5');
    if (r5Error || !isR5) {
      // Fallback lecture profil
      const { data: profile } = await userClient
        .from('ros6_user_profiles')
        .select('app_role, status')
        .eq('user_id', user.id)
        .maybeSingle();
      if (!(profile?.app_role === 'R5' && profile?.status === 'Actif')) {
        return new Response(JSON.stringify({ ok: false, error: 'Réservé au R5' }), {
          status: 403,
          headers: { ...cors, 'Content-Type': 'application/json' },
        });
      }
    }

    const body = await req.json();
    if (body?.action !== 'set_password') {
      return new Response(JSON.stringify({ ok: false, error: 'Action inconnue' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const email = String(body.email || '')
      .trim()
      .toLowerCase();
    const password = String(body.password || '');
    if (!email || password.length < 6) {
      return new Response(JSON.stringify({ ok: false, error: 'E-mail / mot de passe invalide' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: listed, error: listError } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    if (listError) throw listError;
    const target = (listed?.users || []).find(
      (u) => (u.email || '').toLowerCase() === email
    );
    if (!target) {
      return new Response(JSON.stringify({ ok: false, error: 'Utilisateur Auth introuvable' }), {
        status: 404,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const { error: updError } = await admin.auth.admin.updateUserById(target.id, {
      password,
    });
    if (updError) throw updError;

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ ok: false, error: error?.message || String(error) }),
      {
        status: 500,
        headers: { ...cors, 'Content-Type': 'application/json' },
      }
    );
  }
});
