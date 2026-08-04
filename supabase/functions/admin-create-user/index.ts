/**
 * Edge Function : création / association sécurisée d'un compte R4-R5.
 *
 * - Vérifie le JWT + profil R5 Actif
 * - Utilise la Service Role Key uniquement côté serveur
 * - Réutilise auth.users.id existant (recherche par e-mail)
 * - Crée le compte Auth si besoin (Admin API)
 * - Upsert ros6_user_profiles avec le véritable UUID
 * - Si Auth créé puis profil échoue -> suppression du compte Auth orphelin
 *
 * Secrets (Dashboard -> Edge Functions -> Secrets) :
 *   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
 * (souvent déjà fournis automatiquement sur Supabase Hosted)
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type Body = {
  email?: string;
  password?: string;
  player_id?: string;
  app_role?: string;
  status?: string;
};

function json(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function findAuthUserByEmail(
  admin: ReturnType<typeof createClient>,
  email: string
) {
  const target = email.toLowerCase();
  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) throw error;
    const users = data?.users || [];
    const found = users.find((u) => (u.email || "").toLowerCase() === target);
    if (found) return found;
    if (users.length < 200) break;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json(405, { ok: false, error: "Méthode non autorisée." });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

  if (!supabaseUrl || !anonKey || !serviceKey) {
    return json(500, {
      ok: false,
      error:
        "Configuration serveur incomplète (SUPABASE_URL / ANON / SERVICE_ROLE).",
    });
  }

  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return json(401, { ok: false, error: "Non authentifié." });
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json(400, { ok: false, error: "Corps JSON invalide." });
  }

  const email = String(body.email || "")
    .trim()
    .toLowerCase();
  const password = String(body.password || "");
  const playerId = String(body.player_id || "").trim();
  const appRole = String(body.app_role || "R4").trim();
  const status = String(body.status || "Actif").trim();

  if (!email || !email.includes("@")) {
    return json(400, { ok: false, error: "Adresse e-mail invalide." });
  }
  if (password.length < 6) {
    return json(400, {
      ok: false,
      error: "Mot de passe temporaire : 6 caractères minimum.",
    });
  }
  if (!playerId) {
    return json(400, {
      ok: false,
      error: "Le joueur associé est obligatoire.",
    });
  }
  if (appRole !== "R4" && appRole !== "R5") {
    return json(400, { ok: false, error: "Rôle invalide (R4 ou R5)." });
  }
  if (status !== "Actif" && status !== "Désactivé") {
    return json(400, { ok: false, error: "Statut invalide." });
  }

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user: caller },
    error: callerError,
  } = await callerClient.auth.getUser();

  if (callerError || !caller) {
    return json(401, { ok: false, error: "Non authentifié." });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: callerProfile, error: callerProfileError } = await admin
    .from("ros6_user_profiles")
    .select("user_id, app_role, status")
    .eq("user_id", caller.id)
    .maybeSingle();

  if (callerProfileError) {
    return json(500, {
      ok: false,
      error: `Lecture profil appelant impossible : ${callerProfileError.message}`,
    });
  }

  if (!(callerProfile?.app_role === "R5" && callerProfile?.status === "Actif")) {
    return json(403, {
      ok: false,
      error: "Seul un R5 actif peut créer un utilisateur.",
    });
  }

  let authUser: Awaited<ReturnType<typeof findAuthUserByEmail>> = null;
  let authCreated = false;

  try {
    authUser = await findAuthUserByEmail(admin, email);

    if (!authUser) {
      const { data: created, error: createError } = await admin.auth.admin
        .createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { created_via: "ros6_admin_create_user" },
        });
      if (createError || !created?.user?.id) {
        return json(400, {
          ok: false,
          error: createError?.message || "Impossible de créer le compte Auth.",
        });
      }
      authUser = created.user;
      authCreated = true;
    } else {
      const { error: pwdError } = await admin.auth.admin.updateUserById(
        authUser.id,
        { password, email_confirm: true }
      );
      if (pwdError) {
        return json(400, {
          ok: false,
          error:
            `Compte Auth trouvé mais mot de passe non mis à jour : ${pwdError.message}`,
        });
      }
    }

    const userId = authUser.id;

    const { data: byPlayer, error: byPlayerErr } = await admin
      .from("ros6_user_profiles")
      .select("user_id, email, player_id")
      .eq("player_id", playerId)
      .maybeSingle();
    if (byPlayerErr) throw byPlayerErr;

    if (byPlayer && byPlayer.user_id !== userId) {
      if (authCreated) {
        await admin.auth.admin.deleteUser(userId);
      }
      return json(409, {
        ok: false,
        error: "Ce joueur possède déjà un accès.",
      });
    }

    const { data: byEmail, error: byEmailErr } = await admin
      .from("ros6_user_profiles")
      .select("user_id, email, player_id")
      .eq("email", email)
      .maybeSingle();
    if (byEmailErr) throw byEmailErr;

    if (byEmail && byEmail.user_id !== userId) {
      if (authCreated) {
        await admin.auth.admin.deleteUser(userId);
      }
      return json(409, {
        ok: false,
        error: "Cette adresse est déjà associée à un joueur.",
      });
    }

    const { data: existingProfile, error: existingErr } = await admin
      .from("ros6_user_profiles")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (existingErr) throw existingErr;

    const profilePayload = {
      user_id: userId,
      email,
      player_id: playerId,
      app_role: appRole,
      status,
      updated_at: new Date().toISOString(),
    };

    let profile;
    if (existingProfile) {
      const { data, error } = await admin
        .from("ros6_user_profiles")
        .update({
          email: profilePayload.email,
          player_id: profilePayload.player_id,
          app_role: profilePayload.app_role,
          status: profilePayload.status,
          updated_at: profilePayload.updated_at,
        })
        .eq("user_id", userId)
        .select("*")
        .single();
      if (error) throw error;
      profile = data;
    } else {
      const { data, error } = await admin
        .from("ros6_user_profiles")
        .insert(profilePayload)
        .select("*")
        .single();
      if (error) throw error;
      profile = data;
    }

    return json(200, {
      ok: true,
      message: "Utilisateur créé et associé avec succès",
      auth_created: authCreated,
      profile,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (authCreated && authUser?.id) {
      try {
        await admin.auth.admin.deleteUser(authUser.id);
      } catch {
        // ignore cleanup failure
      }
    }

    if (/foreign key|user_id_fkey/i.test(message)) {
      return json(400, {
        ok: false,
        error:
          "Le compte existe mais son profil n'a pas pu être créé (identifiant Auth invalide).",
      });
    }
    if (/duplicate|unique|23505/i.test(message)) {
      return json(409, {
        ok: false,
        error: "Cette adresse est déjà associée à un joueur.",
      });
    }

    return json(500, {
      ok: false,
      error: message || "Le compte existe mais son profil n'a pas pu être créé.",
    });
  }
});
