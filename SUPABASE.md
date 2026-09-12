# ROS6 Command Center — Supabase (copie)

Ce dossier est une **copie** du Command Center branchée sur Supabase.
Le projet original n’est pas modifié.

## Création des utilisateurs R4 / R5

Suivre le guide pas à pas :

→ **[SUPABASE-USER-SETUP.md](./SUPABASE-USER-SETUP.md)**

Résumé :

1. Exécuter `supabase/migrations/20260804_admin_create_user.sql` dans le SQL Editor.
2. Déployer l’Edge Function `admin-create-user`.
3. Garder la **Service Role Key** uniquement en secret serveur (jamais dans le front ni GitHub).
4. Créer / associer les comptes depuis **Paramètres → Gestion des accès**.

## Structure localStorage

| Clé | Contenu | Sync Supabase |
|-----|---------|---------------|
| `ros6_command_center_v1` | Joueurs, semaines VS, archives, tranches, notes, suivis | Oui → `ros6_state` |
| `ros6_train_v1` | Train | Oui |
| `ros6_ruche_v1` | Ruche | Oui |
| `ros6_tempete_v1` | Tempête | Oui |
| `ros6_backups_v1` | Sauvegardes navigateur (max 10) | **Non** — local uniquement |

Les stores métier sont regroupées dans `ros6_state.data.stores` (ligne `id = main`).
Une éventuelle copie distante de `ros6_backups_v1` (héritage) est **ignorée** par l’app et n’est plus écrite ni lue au sync.

## Profils (`ros6_user_profiles`)

| Colonne | Contenu |
|---------|---------|
| `user_id` | UUID Auth réel (`auth.users.id`) |
| `email` | E-mail |
| `player_id` | Joueur associé (unique) |
| `app_role` | R4 / R5 |
| `status` | Actif / Désactivé |
| `last_sign_in_at` | Dernière connexion |

Identité affichée = **pseudo du joueur associé**.

## Clés

- Front : Publishable / anon key uniquement (`js/supabase-client.js`).
- **Jamais** de Secret / Service Role Key dans le navigateur, GitHub ou fichiers publics.
