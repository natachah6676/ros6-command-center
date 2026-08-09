/**
 * Tests logique conflit sync (sans rechargement, faux positifs exclus).
 * Exécution : node scripts/test-sync-conflict.js
 */
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** Miroir de isExternalRemoteConflict (supabase-sync.js). */
function isExternalRemoteConflict(remoteVersion, localVersion, ownPushedVersions) {
  const version = Number(remoteVersion) || 0;
  if (version <= localVersion) return false;
  if (ownPushedVersions.has(version)) return false;
  return true;
}

console.log('=== Sync conflit / propres écritures ===');

const own = new Set();

// Même version : pas de conflit
assert(!isExternalRemoteConflict(5, 5, own), 'remote == local → pas de conflit');

// Remote plus ancien : pas de conflit
assert(!isExternalRemoteConflict(4, 5, own), 'remote < local → pas de conflit');

// Remote plus récent, pas poussé par cet onglet → conflit réel (autre appareil/user)
assert(isExternalRemoteConflict(6, 5, own), 'remote > local inconnu → conflit externe');

// Après notre push réussi version 6, un re-fetch ne doit pas être un conflit
own.add(6);
assert(!isExternalRemoteConflict(6, 5, own), 'propre version 6 → pas de conflit');
assert(!isExternalRemoteConflict(6, 6, own), 'aligné sur propre version → pas de conflit');

// Une version 7 inconnue reste un conflit externe
assert(isExternalRemoteConflict(7, 6, own), 'version 7 tierce → conflit externe');

console.log('OK — 6 assertions sync conflit');
console.log('(Voir aussi scripts/test-sync-scoped.js pour la sync par module.)');
