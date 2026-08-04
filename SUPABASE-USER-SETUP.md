# Guide simple — Création des comptes R4 / R5

Ce guide explique comment activer la création d’utilisateurs depuis **Paramètres → Gestion des accès**.

Aucune Secret Key ne doit être copiée dans le site, ni dans GitHub.

---

## Étape 1 — Exécuter le SQL

1. Ouvre ton projet sur [https://supabase.com/dashboard](https://supabase.com/dashboard).
2. Menu de gauche : **SQL Editor**.
3. Clique sur **New query**.
4. Ouvre le fichier du projet :
   `supabase/migrations/20260804_admin_create_user.sql`
5. Copie **tout** son contenu dans l’éditeur SQL.
6. Clique sur **Run** (ou Ctrl+Enter).
7. Vérifie le message de succès (pas d’erreur rouge).

Ce SQL :
- crée / corrige la table `ros6_user_profiles` ;
- garde la sécurité RLS ;
- **ne supprime aucune donnée**.

---

## Étape 2 — Déployer l’Edge Function

### Option A — avec Supabase CLI (recommandé)

1. Installe la CLI si besoin : [https://supabase.com/docs/guides/cli](https://supabase.com/docs/guides/cli)
2. Dans un terminal, place-toi dans le dossier du projet Supabase :
   `Poste de Commande ROS - Supabase`
3. Connecte-toi :
   ```bash
   supabase login
   ```
4. Lie le projet (Project ID visible dans Dashboard → Project Settings → General) :
   ```bash
   supabase link --project-ref flussmbsccowystdqbvf
   ```
5. Déploie la fonction :
   ```bash
   supabase functions deploy admin-create-user
   ```

### Option B — depuis le Dashboard

1. Menu **Edge Functions**.
2. **Create a new function** nommée exactement : `admin-create-user`
3. Colle le contenu de :
   `supabase/functions/admin-create-user/index.ts`
4. Déploie / Save.

---

## Étape 3 — Secrets serveur (Service Role Key)

1. Dashboard → **Project Settings** → **API**.
2. Repère :
   - **Project URL**
   - **anon public** (Publishable / anon)
   - **service_role** (Secret — ne jamais la partager)
3. Dashboard → **Edge Functions** → **Secrets** (ou Project Settings → Edge Functions).
4. Vérifie / ajoute ces secrets **uniquement côté serveur** :

| Nom | Valeur |
|-----|--------|
| `SUPABASE_URL` | Project URL |
| `SUPABASE_ANON_KEY` | clé anon / publishable |
| `SUPABASE_SERVICE_ROLE_KEY` | clé **service_role** |

Sur Supabase Hosted, `SUPABASE_URL`, `SUPABASE_ANON_KEY` et `SUPABASE_SERVICE_ROLE_KEY` sont souvent déjà injectés automatiquement. Si la fonction répond « Configuration serveur incomplète », ajoute-les manuellement ici.

**Interdit :**
- coller la Service Role Key dans `js/` ;
- la committer sur GitHub ;
- l’afficher dans le navigateur.

---

## Étape 4 — Tester

1. Recharge l’application (Ctrl+F5).
2. Connecte-toi avec ton compte **R5**.
3. Va dans **Paramètres → Gestion des accès**.
4. Clique **+ Ajouter un utilisateur**.
5. Remplis :
   - e-mail (ex. un nouveau, ou `natenzo1@hotmail.com` déjà existant) ;
   - mot de passe temporaire ;
   - joueur associé ;
   - rôle R4.
6. Clique **Créer**.
7. Message attendu : **Utilisateur créé et associé avec succès**.
8. Déconnecte-toi, reconnecte-toi avec ce compte R4.
9. Vérifie que le **pseudo du joueur** s’affiche (pas l’e-mail).
10. En tant que R4, vérifie que l’onglet **Gestion des accès** est invisible.

---

## Étape 5 — Remettre sur GitHub

Tu peux pousser ces fichiers (sans secret) :

- `supabase/migrations/20260804_admin_create_user.sql`
- `supabase/functions/admin-create-user/index.ts`
- `supabase/schema.sql`
- `js/profiles.js`
- `index.html`
- `SUPABASE-USER-SETUP.md`
- `SUPABASE.md`

**Ne jamais committer :**
- la Service Role Key ;
- un fichier `.env` contenant des secrets ;
- une clé `service_role` dans le code front.

La Publishable / anon key peut rester dans `js/supabase-client.js` (déjà le cas).

---

## Dépannage rapide

| Message | Que faire |
|---------|-----------|
| Seul un R5 actif peut créer un utilisateur | Ton profil doit être `app_role = R5` et `status = Actif`. |
| Ce joueur possède déjà un accès | Choisis un autre joueur, ou détache l’ancien compte. |
| Cette adresse est déjà associée à un joueur | L’e-mail a déjà un profil ; modifie-le dans le tableau au lieu de recréer. |
| Function not found / Failed to send | La fonction `admin-create-user` n’est pas déployée. |
| Configuration serveur incomplète | Ajoute les 3 secrets (étape 3). |
| Foreign key / user_id_fkey | Ancien flux navigateur : redéploie la fonction et recharge l’app. |
