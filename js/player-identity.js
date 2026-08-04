/**
 * Identité joueur — ID interne stable, pseudo = affichage uniquement.
 * Migration des anciennes clés « pseudo » → id, sans perte ni doublon.
 */
(function (global) {
  function getPlayers(stateOrPlayers) {
    if (Array.isArray(stateOrPlayers)) return stateOrPlayers;
    return Array.isArray(stateOrPlayers?.players) ? stateOrPlayers.players : [];
  }

  function getPlayerById(stateOrPlayers, playerId) {
    if (!playerId) return null;
    return getPlayers(stateOrPlayers).find((p) => p.id === playerId) || null;
  }

  /** Pseudo live pour affichage (historique inclus). */
  function getDisplayName(stateOrPlayers, playerId, fallback = '—') {
    if (!playerId) return fallback || '—';
    const live = getPlayerById(stateOrPlayers, playerId);
    if (live?.pseudo) return live.pseudo;
    return fallback || '—';
  }

  function isKnownPlayerId(players, key) {
    return players.some((p) => p.id === key);
  }

  function findIdByPseudo(players, pseudo) {
    const target = String(pseudo || '')
      .trim()
      .toLowerCase();
    if (!target) return null;
    const player = players.find((p) => String(p.pseudo || '').trim().toLowerCase() === target);
    return player ? player.id : null;
  }

  function mergeCountRows(a, b) {
    return {
      conductor: Math.max(Number(a?.conductor) || 0, Number(b?.conductor) || 0),
      vip: Math.max(Number(a?.vip) || 0, Number(b?.vip) || 0),
    };
  }

  function mergeScoreRows(a, b) {
    const days = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi'];
    const out = {
      days: { lundi: 0, mardi: 0, mercredi: 0, jeudi: 0, vendredi: 0 },
      allianceDonMissed: Boolean(a?.allianceDonMissed || b?.allianceDonMissed),
    };
    days.forEach((key) => {
      const values = [Number(a?.days?.[key]) || 0, Number(b?.days?.[key]) || 0];
      out.days[key] = values.includes(10) ? 10 : values.includes(5) ? 5 : 0;
    });
    return out;
  }

  /**
   * Migre les clés d’une map pseudo → id.
   * mergeFn(existing, incoming) optionnel.
   */
  function migrateMapKeysToPlayerIds(map, players, options = {}) {
    if (!map || typeof map !== 'object' || Array.isArray(map)) {
      return { map: map && typeof map === 'object' ? map : {}, changed: false };
    }
    const mergeFn = options.mergeFn || ((existing, incoming) => existing ?? incoming);
    const explicit = options.explicitPseudo;
    const explicitId = options.explicitPlayerId;
    const next = { ...map };
    let changed = false;

    Object.keys(map).forEach((key) => {
      if (isKnownPlayerId(players, key)) return;

      let targetId = null;
      if (explicit && explicitId && String(key).trim().toLowerCase() === String(explicit).trim().toLowerCase()) {
        targetId = explicitId;
      } else {
        targetId = findIdByPseudo(players, key);
      }
      if (!targetId) return;

      if (Object.prototype.hasOwnProperty.call(next, targetId)) {
        next[targetId] = mergeFn(next[targetId], next[key]);
      } else {
        next[targetId] = next[key];
      }
      delete next[key];
      changed = true;
    });

    return { map: next, changed };
  }

  function migrateMainState(state, options = {}) {
    if (!state || typeof state !== 'object') return { state, changed: false };
    const players = getPlayers(state);
    let changed = false;

    if (Array.isArray(state.weeks)) {
      state.weeks.forEach((week) => {
        if (!week || typeof week.scores !== 'object') return;
        const result = migrateMapKeysToPlayerIds(week.scores, players, {
          ...options,
          mergeFn: mergeScoreRows,
        });
        if (result.changed) {
          week.scores = result.map;
          changed = true;
        }
      });
    }

    if (state.playerWeekNotes && typeof state.playerWeekNotes === 'object') {
      const result = migrateMapKeysToPlayerIds(state.playerWeekNotes, players, {
        ...options,
        mergeFn: (a, b) => ({ ...(b || {}), ...(a || {}) }),
      });
      if (result.changed) {
        state.playerWeekNotes = result.map;
        changed = true;
      }
    }

    return { state, changed };
  }

  function migrateTrainState(trainState, players, options = {}) {
    if (!trainState || typeof trainState !== 'object') return { changed: false };
    let changed = false;
    const months = trainState.monthlyCounts;
    if (months && typeof months === 'object') {
      Object.keys(months).forEach((monthKey) => {
        const bucket = months[monthKey];
        if (!bucket || typeof bucket !== 'object') return;
        const result = migrateMapKeysToPlayerIds(bucket, players, {
          ...options,
          mergeFn: mergeCountRows,
        });
        if (result.changed) {
          months[monthKey] = result.map;
          changed = true;
        }
      });
    }
    return { changed };
  }

  function migrateRucheState(rucheState, players, options = {}) {
    if (!rucheState || typeof rucheState !== 'object') return { changed: false };
    let changed = false;
    const resolve = (value) => {
      if (!value || value === 'FREE') return value;
      if (isKnownPlayerId(players, value)) return value;
      if (
        options.explicitPseudo &&
        options.explicitPlayerId &&
        String(value).trim().toLowerCase() === String(options.explicitPseudo).trim().toLowerCase()
      ) {
        return options.explicitPlayerId;
      }
      return findIdByPseudo(players, value) || value;
    };

    if (Array.isArray(rucheState.grid)) {
      for (let r = 0; r < rucheState.grid.length; r += 1) {
        const row = rucheState.grid[r];
        if (!Array.isArray(row)) continue;
        for (let c = 0; c < row.length; c += 1) {
          const next = resolve(row[c]);
          if (next !== row[c]) {
            row[c] = next;
            changed = true;
          }
        }
      }
    }
    if (rucheState.bottomId) {
      const next = resolve(rucheState.bottomId);
      if (next !== rucheState.bottomId) {
        rucheState.bottomId = next;
        changed = true;
      }
    }
    return { changed };
  }

  function migrateTempeteState(tempeteState, players, options = {}) {
    if (!tempeteState || typeof tempeteState !== 'object') return { changed: false };
    let changed = false;

    const migrateRoster = (roster) => {
      if (!roster || typeof roster !== 'object') return roster;
      const result = migrateMapKeysToPlayerIds(roster, players, {
        ...options,
        mergeFn: (a, b) => ({ ...(b || {}), ...(a || {}) }),
      });
      if (result.changed) changed = true;
      return result.map;
    };

    const migrateAttendance = (att) => {
      if (!att || typeof att !== 'object') return att;
      const result = migrateMapKeysToPlayerIds(att, players, options);
      if (result.changed) changed = true;
      return result.map;
    };

    ['A', 'B'].forEach((key) => {
      const team = tempeteState.teams?.[key];
      if (!team) return;
      team.roster = migrateRoster(team.roster);
      team.attendance = migrateAttendance(team.attendance);
    });

    return { changed };
  }

  /** Après renommage : migre les stores modules (la store principale est déjà à jour). */
  function migrateAllStoresAfterRename(oldPseudo, playerId) {
    if (!oldPseudo || !playerId || !global.ROSStorage) return;
    const options = { explicitPseudo: oldPseudo, explicitPlayerId: playerId };
    const players = ROSStorage.getState().players;

    if (global.TrainModule && typeof TrainModule.migratePlayerIdentity === 'function') {
      TrainModule.migratePlayerIdentity(players, options);
    }
    if (global.RucheModule && typeof RucheModule.migratePlayerIdentity === 'function') {
      RucheModule.migratePlayerIdentity(players, options);
    }
    if (global.TempeteModule && typeof TempeteModule.migratePlayerIdentity === 'function') {
      TempeteModule.migratePlayerIdentity(players, options);
    }

    if (global.TrainModule) TrainModule.render();
    if (global.RucheModule) RucheModule.render();
    if (global.TempeteModule) TempeteModule.render();
  }

  /**
   * Test automatique d’intégrité du renommage (mémoire isolée — ne touche pas au localStorage réel).
   */
  function runRenameIntegrityTest() {
    const errors = [];
    const assert = (cond, msg) => {
      if (!cond) errors.push(msg);
    };

    try {
      const player = ROSModels.createPlayer({ pseudo: 'AncienPseudoTest', role: 'Membre' });
      const week = ROSModels.createWeek(new Date(), { number: 1 });
      week.scores[player.id] = ROSModels.createEmptyScore();
      week.scores[player.id].days.lundi = 5;
      // Ancienne clé legacy par pseudo (compat)
      week.scores.AncienPseudoTest = ROSModels.createEmptyScore();
      week.scores.AncienPseudoTest.days.mardi = 10;

      let state = {
        version: 1,
        appRole: 'R5',
        players: [player],
        weeks: [week],
        currentWeekId: week.id,
        ui: { completedActionsByDate: {} },
        playerWeekNotes: {
          AncienPseudoTest: { [week.id]: { comment: 'note legacy', conducteur: '', vip: '', saison: '' } },
        },
        powerTiers: ROSModels.createDefaultPowerTiers(),
      };

      state = ROSModels.normalizeState(state);
      const migratedPlayer = state.players.find((p) => p.id === player.id);
      assert(Boolean(migratedPlayer), 'Joueur toujours présent après normalize');
      assert(Boolean(state.weeks[0].scores[player.id]), 'Scores rattachés à l’ID');
      assert(!state.weeks[0].scores.AncienPseudoTest, 'Clé pseudo legacy migrée');
      assert(state.weeks[0].scores[player.id].days.lundi === 5, 'Score lundi conservé');
      assert(state.weeks[0].scores[player.id].days.mardi === 10, 'Score mardi legacy fusionné');
      assert(Boolean(state.playerWeekNotes[player.id]), 'Notes migrées vers ID');

      const beforeCount = state.players.length;
      migratedPlayer.pseudo = 'NouveauPseudoTest';
      migrateMainState(state, {
        explicitPseudo: 'AncienPseudoTest',
        explicitPlayerId: player.id,
      });

      assert(state.players.length === beforeCount, 'Aucun joueur créé au renommage');
      assert(state.players.filter((p) => p.id === player.id).length === 1, 'Joueur unique par ID');
      assert(
        getDisplayName(state, player.id) === 'NouveauPseudoTest',
        'Affichage = nouveau pseudo'
      );
      assert(Boolean(state.weeks[0].scores[player.id]), 'Stats conservées après renommage');
      assert(state.weeks.length >= 1, 'Archives/semaines conservées');
    } catch (error) {
      errors.push(`Exception: ${error.message || error}`);
    }

    return { ok: errors.length === 0, errors };
  }

  global.ROSPlayerIdentity = {
    getDisplayName,
    getPlayerById,
    findIdByPseudo,
    migrateMainState,
    migrateMapKeysToPlayerIds,
    migrateTrainState,
    migrateRucheState,
    migrateTempeteState,
    migrateAllStoresAfterRename,
    runRenameIntegrityTest,
  };
})(window);
