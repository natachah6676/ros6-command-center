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

    if (state.playerVsUnderStats && typeof state.playerVsUnderStats === 'object') {
      const result = migrateMapKeysToPlayerIds(state.playerVsUnderStats, players, {
        ...options,
        mergeFn: (a, b) => {
          const entries = [...(a?.entries || []), ...(b?.entries || [])];
          const seen = new Set();
          const merged = [];
          entries.forEach((e) => {
            const key = e?.weekId || `${e?.startDate || ''}_${e?.at || ''}`;
            if (seen.has(key)) return;
            seen.add(key);
            merged.push(e);
          });
          return { entries: merged.slice(0, 8) };
        },
      });
      if (result.changed) {
        state.playerVsUnderStats = result.map;
        changed = true;
      }
    }

    if (state.playerFollowUps && typeof state.playerFollowUps === 'object') {
      const result = migrateMapKeysToPlayerIds(state.playerFollowUps, players, {
        ...options,
        mergeFn: (a, b) => ({ ...(b || {}), ...(a || {}) }),
      });
      if (result.changed) {
        state.playerFollowUps = result.map;
        changed = true;
      }
    }

    if (state.playerFollowUpNotes && typeof state.playerFollowUpNotes === 'object') {
      const result = migrateMapKeysToPlayerIds(state.playerFollowUpNotes, players, {
        ...options,
        mergeFn: (a, b) => {
          if (global.ROSModels && typeof ROSModels.mergeFollowUpNotesArrays === 'function') {
            return {
              notes: ROSModels.mergeFollowUpNotesArrays(a?.notes || a, b?.notes || b),
            };
          }
          const notes = [...(a?.notes || []), ...(b?.notes || [])];
          return { notes };
        },
      });
      if (result.changed) {
        state.playerFollowUpNotes = result.map;
        changed = true;
      }
    }

    if (state.playerFollowUpAutoSuppress && typeof state.playerFollowUpAutoSuppress === 'object') {
      const result = migrateMapKeysToPlayerIds(state.playerFollowUpAutoSuppress, players, options);
      if (result.changed) {
        state.playerFollowUpAutoSuppress = result.map;
        changed = true;
      }
    }

    if (state.playerFollowUpArchives && typeof state.playerFollowUpArchives === 'object') {
      const explicit = options.explicitPseudo;
      const explicitId = options.explicitPlayerId;
      Object.keys(state.playerFollowUpArchives).forEach((archiveId) => {
        const archive = state.playerFollowUpArchives[archiveId];
        if (!archive || typeof archive !== 'object') return;
        const rewriteId = (value) => {
          if (!value || isKnownPlayerId(players, value)) return value;
          if (
            explicit &&
            explicitId &&
            String(value).trim().toLowerCase() === String(explicit).trim().toLowerCase()
          ) {
            return explicitId;
          }
          return findIdByPseudo(players, value) || value;
        };
        const nextPlayerId = rewriteId(archive.playerId);
        const nextAssigneeId = rewriteId(archive.assigneePlayerId);
        if (nextPlayerId !== archive.playerId) {
          archive.playerId = nextPlayerId;
          changed = true;
        }
        if (nextAssigneeId !== archive.assigneePlayerId) {
          archive.assigneePlayerId = nextAssigneeId;
          changed = true;
        }
      });
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
      if (value === 'MARSHAL' || value === 'marshal') return 'MARSHAL';
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
          // Case centrale = événement Maréchal fixe (jamais un id joueur).
          if (r === 4 && c === 4) {
            if (row[c] !== 'MARSHAL') {
              row[c] = 'MARSHAL';
              changed = true;
            }
            continue;
          }
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
  };
})(window);
