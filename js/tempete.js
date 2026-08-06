/**
 * Module Tempête du Désert — indépendant (stockage dédié)
 * Lit puissance héros / volant préféré sur la fiche joueur (pas de doublon).
 * Prêt à exposer absences/alertes au Poste de Commandement plus tard.
 */
(function (global) {
  const STORAGE_KEY = 'ros6_tempete_v1';

  const AVAIL = {
    indisponible: 'Indisponible',
    disponible: 'Disponible',
    peut_etre: 'Peut-être disponible',
  };
  const SELECT = {
    participant: 'Participant',
    remplacant: 'Remplaçant',
    non_retenu: 'Non retenu',
  };
  const ATTEND = {
    present: 'Présent',
    absent_excuse: 'Absent excusé',
    absent: 'Absent non excusé',
  };

  const ATTEND_UI = {
    present: '🟢 Présent',
    absent_excuse: '🟡 Absent excusé',
    absent: '🔴 Absent',
  };

  const PHASE1_BUILDINGS = [
    { key: 'hopital1', label: 'Hôpital 1', group: 'hopital' },
    { key: 'hopital2', label: 'Hôpital 2', group: 'hopital' },
    { key: 'hopital3', label: 'Hôpital 3', group: 'hopital' },
    { key: 'hopital4', label: 'Hôpital 4', group: 'hopital' },
    { key: 'pole', label: 'Pôle scientifique', group: 'pole' },
    { key: 'raffinerie1', label: 'Raffinerie 1', group: 'raffinerie' },
    { key: 'raffinerie2', label: 'Raffinerie 2', group: 'raffinerie' },
    { key: 'centre', label: "Centre d'information", group: 'centre' },
  ];

  const PHASE2_BUILDINGS = [
    { key: 'silo', label: 'Silo' },
    { key: 'arsenal', label: 'Arsenal' },
    { key: 'usine', label: 'Usine de mercenaires' },
    { key: 'soutien', label: 'Soutien mobile' },
  ];

  const els = {};
  let state = null;
  let presenceFilter = 'all';
  /** Mode de la fenêtre commune : 'verify' | 'close' */
  let rosterModalMode = null;
  /** Tempête ciblée par la fenêtre commune ('A' | 'B'). */
  let rosterModalTeam = 'A';
  /** Brouillon des statuts pour la clôture (avant confirmation). */
  let closeAttendanceDraft = {};

  function uid(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function createBlankTeam() {
    return {
      roster: {},
      strategy: null,
      mail: '',
      attendance: {},
    };
  }

  function createBlankTeamValidation() {
    return {
      A: { validated: false, fingerprint: '' },
      B: { validated: false, fingerprint: '' },
    };
  }

  function normalizeTeamValidation(raw) {
    const blank = createBlankTeamValidation();
    const src = raw && typeof raw === 'object' ? raw : {};
    ['A', 'B'].forEach((key) => {
      const row = src[key] && typeof src[key] === 'object' ? src[key] : {};
      blank[key] = {
        validated: Boolean(row.validated),
        fingerprint: String(row.fingerprint || ''),
      };
    });
    return blank;
  }

  function createBlankState() {
    return {
      version: 1,
      activeTeam: 'A',
      hours: { A: '13h', B: '22h' },
      teams: { A: createBlankTeam(), B: createBlankTeam() },
      archives: [],
      recommendationStats: {},
      teamValidation: createBlankTeamValidation(),
    };
  }

  function normalizeRosterEntry(raw) {
    return {
      availability: Object.keys(AVAIL).includes(raw?.availability) ? raw.availability : 'indisponible',
      selection: Object.keys(SELECT).includes(raw?.selection) ? raw.selection : 'non_retenu',
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        state = createBlankState();
        persist();
        return state;
      }
      const parsed = JSON.parse(raw);
      const blank = createBlankState();
      state = {
        version: 1,
        activeTeam: parsed.activeTeam === 'B' ? 'B' : 'A',
        hours: {
          A: String(parsed.hours?.A || '13h'),
          B: String(parsed.hours?.B || '22h'),
        },
        teams: {
          A: {
            roster:
              parsed.teams?.A?.roster && typeof parsed.teams.A.roster === 'object'
                ? parsed.teams.A.roster
                : {},
            strategy: parsed.teams?.A?.strategy || null,
            mail: String(parsed.teams?.A?.mail || ''),
            attendance:
              parsed.teams?.A?.attendance && typeof parsed.teams.A.attendance === 'object'
                ? parsed.teams.A.attendance
                : {},
          },
          B: {
            roster:
              parsed.teams?.B?.roster && typeof parsed.teams.B.roster === 'object'
                ? parsed.teams.B.roster
                : {},
            strategy: parsed.teams?.B?.strategy || null,
            mail: String(parsed.teams?.B?.mail || ''),
            attendance:
              parsed.teams?.B?.attendance && typeof parsed.teams.B.attendance === 'object'
                ? parsed.teams.B.attendance
                : {},
          },
        },
        archives: Array.isArray(parsed.archives) ? parsed.archives : blank.archives,
        recommendationStats:
          parsed.recommendationStats && typeof parsed.recommendationStats === 'object'
            ? parsed.recommendationStats
            : {},
        teamValidation: normalizeTeamValidation(
          parsed.teamValidation ||
            (parsed.playersValidated
              ? {
                  // Ancienne validation globale : on ne la reporte pas (re-validation par Tempête)
                  A: { validated: false, fingerprint: '' },
                  B: { validated: false, fingerprint: '' },
                }
              : null)
        ),
      };
      if (global.ROSPlayerIdentity && global.ROSStorage) {
        ROSPlayerIdentity.migrateTempeteState(state, ROSStorage.getState().players);
      }
      // Recalcule les stats de recommandation depuis les archives (compatibilité anciennes archives)
      const rebuilt = rebuildRecommendationStats(state.archives);
      const changed =
        JSON.stringify(rebuilt) !== JSON.stringify(state.recommendationStats || {});
      state.recommendationStats = rebuilt;
      // Invalide les validations obsolètes (sélection modifiée hors session)
      let validationChanged = false;
      ['A', 'B'].forEach((key) => {
        const row = state.teamValidation[key];
        if (row.validated && row.fingerprint !== getTeamRosterFingerprint(key)) {
          row.validated = false;
          row.fingerprint = '';
          validationChanged = true;
        }
      });
      if (changed || validationChanged) persist();
      return state;
    } catch (error) {
      console.error('Tempête: chargement impossible', error);
      state = createBlankState();
      return state;
    }
  }

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if (global.ROSSync && typeof ROSSync.schedulePush === 'function') {
      ROSSync.schedulePush();
    }
  }

  function getState() {
    if (!state) loadState();
    return state;
  }

  function update(mutator) {
    const current = getState();
    state = mutator(current) || current;
    persist();
    render();
  }

  function getActivePlayers() {
    return ROSStorage.getState()
      .players.filter((p) => p.status === 'Actif')
      .sort((a, b) => a.pseudo.localeCompare(b.pseudo, 'fr', { sensitivity: 'base' }));
  }

  function getPlayerById(id) {
    return ROSStorage.getPlayerById(id);
  }

  function powerTiers() {
    return ROSModels.getPowerTiers(ROSStorage.getState());
  }

  /** Tri / équilibre : max de la tranche (jamais saisie libre). */
  function heroPower(player) {
    return Math.max(0, ROSModels.getPlayerPowerSortValue(player, powerTiers()));
  }

  /** Valeur centrale de tranche pour les moyennes affichées (ex. 25–30 → 27,5). */
  function heroPowerMid(player) {
    const tier = ROSModels.getPlayerPowerTier(player, powerTiers());
    if (!tier) return 0;
    const min = Number(tier.min);
    const max = Number(tier.max);
    if (!Number.isFinite(min) || !Number.isFinite(max)) return 0;
    return (min + max) / 2;
  }

  function heroPowerLabel(player) {
    return ROSModels.getPlayerPowerLabel(player, powerTiers());
  }

  function formatPowerMid(value) {
    if (value == null || !Number.isFinite(value) || value <= 0) return null;
    const rounded = Math.round(value * 10) / 10;
    const text = Number.isInteger(rounded) ? String(rounded) : String(rounded).replace('.', ',');
    return `${text} M`;
  }

  function averageMidOfIds(ids) {
    const vals = (ids || [])
      .map((id) => heroPowerMid(getPlayerById(id)))
      .filter((v) => v > 0);
    if (!vals.length) return null;
    return vals.reduce((sum, v) => sum + v, 0) / vals.length;
  }

  const ASSIGNMENT_ROWS = [
    { key: 'volants', label: 'Volants', kind: 'volant' },
    ...PHASE1_BUILDINGS.map((b) => ({ key: b.key, label: b.label, kind: 'phase1' })),
  ];

  function activeTeamKey() {
    return getState().activeTeam === 'B' ? 'B' : 'A';
  }

  function getTeam(key = activeTeamKey()) {
    return getState().teams[key];
  }

  function oppositeTeamKey(teamKey = activeTeamKey()) {
    return teamKey === 'B' ? 'A' : 'B';
  }

  /** Affectation globale Tempête (Participant/Remplaçant A ou B). */
  function getStormAssignment(playerId) {
    if (!playerId) return { team: null, role: null, label: 'Non affecté' };
    const s = getState();
    for (const teamKey of ['A', 'B']) {
      const raw = s.teams[teamKey]?.roster?.[playerId];
      if (!raw) continue;
      const entry = normalizeRosterEntry(raw);
      if (entry.selection === 'participant') {
        return { team: teamKey, role: 'participant', label: `Participant ${teamKey}` };
      }
      if (entry.selection === 'remplacant') {
        return { team: teamKey, role: 'remplacant', label: `Remplaçant ${teamKey}` };
      }
    }
    return { team: null, role: null, label: 'Non affecté' };
  }

  function isAssignedOnOtherTeam(playerId, teamKey = activeTeamKey()) {
    const a = getStormAssignment(playerId);
    return Boolean(a.team && a.team !== teamKey);
  }

  function emptyPlayerStatRow() {
    return {
      participantA: 0,
      participantB: 0,
      remplacantA: 0,
      remplacantB: 0,
      absent: 0,
      absent_excuse: 0,
      non_inscrit: 0,
      presentA: 0,
      inscribedA: 0,
      presentB: 0,
      inscribedB: 0,
    };
  }

  /** Dérive les outcomes joueurs d’une archive (nouvelle ou legacy). */
  function archivePlayerOutcomes(arch) {
    if (arch?.playerOutcomes && typeof arch.playerOutcomes === 'object') {
      return arch.playerOutcomes;
    }
    const outcomes = {};
    const team = arch?.team === 'B' ? 'B' : 'A';
    const mark = (list, role) => {
      (list || []).forEach((p) => {
        const id = p?.id || p;
        if (!id) return;
        const attendance = arch.attendance?.[id] || null;
        outcomes[id] = { role, attendance, team };
      });
    };
    mark(arch?.participants, 'participant');
    mark(arch?.remplacants, 'remplacant');
    return outcomes;
  }

  function rebuildRecommendationStats(archives) {
    const stats = {};
    const ensure = (id) => {
      if (!stats[id]) stats[id] = emptyPlayerStatRow();
      return stats[id];
    };

    (archives || []).forEach((arch) => {
      const team = arch?.team === 'B' ? 'B' : 'A';
      const outcomes = archivePlayerOutcomes(arch);
      const knownIds = new Set(Object.keys(outcomes));

      knownIds.forEach((id) => {
        const o = outcomes[id] || {};
        const row = ensure(id);
        const role = o.role || 'non_inscrit';
        if (role === 'participant') {
          if (team === 'A') row.participantA += 1;
          else row.participantB += 1;
        } else if (role === 'remplacant') {
          if (team === 'A') row.remplacantA += 1;
          else row.remplacantB += 1;
        } else {
          row.non_inscrit += 1;
          return;
        }

        if (team === 'A') row.inscribedA += 1;
        else row.inscribedB += 1;

        if (o.attendance === 'present') {
          if (team === 'A') row.presentA += 1;
          else row.presentB += 1;
        } else if (o.attendance === 'absent') {
          row.absent += 1;
        } else if (o.attendance === 'absent_excuse') {
          row.absent_excuse += 1;
        }
      });
    });

    return stats;
  }

  function getPlayerRecStats(playerId) {
    const row = getState().recommendationStats?.[playerId];
    return row ? { ...emptyPlayerStatRow(), ...row } : emptyPlayerStatRow();
  }

  /**
   * Historique de présence sur les N dernières Tempêtes où le joueur était inscrit
   * (participant ou remplaçant). Sert à composer les équipes — pas de sanction.
   */
  function getPlayerPresenceHistory(playerId, limit = 20) {
    const archives = getState().archives || [];
    const entries = [];

    for (let i = 0; i < archives.length && entries.length < limit; i += 1) {
      const arch = archives[i];
      const outcomes = archivePlayerOutcomes(arch);
      const outcome = outcomes[playerId];
      if (!outcome) continue;
      if (outcome.role !== 'participant' && outcome.role !== 'remplacant') continue;
      const attendance = outcome.attendance || arch.attendance?.[playerId] || null;
      if (!attendance || !Object.keys(ATTEND).includes(attendance)) continue;
      entries.push({
        archiveId: arch.id,
        team: arch.team,
        closedAt: arch.closedAt,
        attendance,
      });
    }

    const present = entries.filter((e) => e.attendance === 'present').length;
    const absentExcuse = entries.filter((e) => e.attendance === 'absent_excuse').length;
    const absent = entries.filter((e) => e.attendance === 'absent').length;
    const total = entries.length;
    const rate = total > 0 ? present / total : null;

    return {
      entries,
      total,
      present,
      absentExcuse,
      absent,
      rate,
      percent: rate == null ? null : Math.round(rate * 100),
    };
  }

  function presenceColorClass(percent) {
    if (percent == null || !Number.isFinite(percent)) return 'presence-unknown';
    if (percent >= 90) return 'presence-green';
    if (percent >= 75) return 'presence-orange';
    return 'presence-red';
  }

  function formatPresencePercent(percent) {
    if (percent == null || !Number.isFinite(percent)) return '—';
    return `${percent} %`;
  }

  function formatSelectionPower(player) {
    const mid = heroPowerMid(player);
    if (mid > 0) {
      const rounded = Math.round(mid);
      return `${rounded} M`;
    }
    return heroPowerLabel(player);
  }

  function presenceRateForTeam(playerId, teamKey) {
    const row = getPlayerRecStats(playerId);
    const inscribed = teamKey === 'B' ? row.inscribedB : row.inscribedA;
    const present = teamKey === 'B' ? row.presentB : row.presentA;
    if (!inscribed) return null;
    return present / inscribed;
  }

  function ensureRosterEntry(team, playerId) {
    if (!team.roster[playerId]) {
      // Nouvelle entrée (nouvelle Tempête / nouveau joueur) → Indisponible par défaut
      team.roster[playerId] = normalizeRosterEntry({});
    } else {
      // Normalise la forme sans changer une disponibilité déjà enregistrée
      team.roster[playerId] = normalizeRosterEntry(team.roster[playerId]);
    }
    return team.roster[playerId];
  }

  /** Initialise les entrées manquantes en Indisponible (ne touche pas aux archives). */
  function seedMissingRosterAsUnavailable(team) {
    getActivePlayers().forEach((p) => {
      if (!team.roster[p.id]) {
        team.roster[p.id] = normalizeRosterEntry({});
      }
    });
  }

  function countSelection(team, selection) {
    return Object.values(team.roster).filter((r) => r.selection === selection).length;
  }

  function getSelectedPlayers(team, selection) {
    const actives = getActivePlayers();
    const listIndex = new Map(actives.map((p, i) => [p.id, i]));
    return actives
      .filter((p) => ensureRosterEntry(team, p.id).selection === selection)
      .map((p) => ({
        id: p.id,
        pseudo: p.pseudo,
        power: heroPower(p),
        preferredVolant: Boolean(p.preferredVolant),
        listIndex: listIndex.get(p.id) ?? 0,
      }));
  }

  /** Empreinte stable de la sélection d’une Tempête (participants + remplaçants). */
  function getTeamRosterFingerprint(teamKey) {
    const s = getState();
    const key = teamKey === 'B' ? 'B' : 'A';
    const team = s.teams?.[key] || createBlankTeam();
    const idsFor = (selection) =>
      Object.keys(team.roster || {})
        .filter((id) => normalizeRosterEntry(team.roster[id]).selection === selection)
        .sort();
    return JSON.stringify({
      p: idsFor('participant'),
      r: idsFor('remplacant'),
    });
  }

  function isPlayersValidated(teamKey = activeTeamKey()) {
    const s = getState();
    const key = teamKey === 'B' ? 'B' : 'A';
    if (!s.teamValidation) s.teamValidation = createBlankTeamValidation();
    const row = s.teamValidation[key] || { validated: false, fingerprint: '' };
    return Boolean(row.validated) && row.fingerprint === getTeamRosterFingerprint(key);
  }

  function clearTeamValidation(targetOrKey = null, maybeKey = null) {
    let s = getState();
    let key = null;
    if (targetOrKey && typeof targetOrKey === 'object' && targetOrKey.teams) {
      s = targetOrKey;
      key = maybeKey === 'B' ? 'B' : maybeKey === 'A' ? 'A' : null;
    } else if (targetOrKey === 'A' || targetOrKey === 'B') {
      key = targetOrKey;
    }
    if (!s.teamValidation) s.teamValidation = createBlankTeamValidation();
    if (key) {
      s.teamValidation[key] = { validated: false, fingerprint: '' };
    } else {
      s.teamValidation = createBlankTeamValidation();
    }
    return s;
  }

  function setActiveTeam(teamKey, options = {}) {
    const key = teamKey === 'B' ? 'B' : 'A';
    const silent = Boolean(options.silent);
    if (getState().activeTeam === key) return key;
    if (silent) {
      getState().activeTeam = key;
      return key;
    }
    update((s) => {
      s.activeTeam = key;
      return s;
    });
    return key;
  }

  function sortByPowerStable(players) {
    return players.slice().sort((a, b) => {
      const d = b.power - a.power;
      if (d !== 0) return d;
      return a.listIndex - b.listIndex;
    });
  }

  /** Max 3 volants — seuils mis à jour. */
  function volantCountFor(n) {
    if (n <= 8) return 1;
    if (n <= 15) return 2;
    return 3;
  }

  function pickVolants(sortedParticipants) {
    const n = sortedParticipants.length;
    const need = Math.min(3, volantCountFor(n));
    const chosen = [];
    const preferred = sortedParticipants.filter((p) => p.preferredVolant);
    preferred.forEach((p) => {
      if (chosen.length < need) chosen.push(p);
    });
    sortedParticipants.forEach((p) => {
      if (chosen.length >= need) return;
      if (!chosen.some((c) => c.id === p.id)) chosen.push(p);
    });
    return chosen.slice(0, need);
  }

  function emptyPhase1() {
    const o = {};
    PHASE1_BUILDINGS.forEach((b) => {
      o[b.key] = [];
    });
    return o;
  }

  function midPowerOfIds(ids) {
    return (ids || []).reduce((sum, id) => sum + heroPowerMid(getPlayerById(id)), 0);
  }

  function sortByMidPowerStable(players) {
    return players.slice().sort((a, b) => {
      const pa = heroPowerMid(getPlayerById(a.id));
      const pb = heroPowerMid(getPlayerById(b.id));
      if (pb !== pa) return pb - pa;
      const d = (b.power || 0) - (a.power || 0);
      if (d !== 0) return d;
      return (a.listIndex || 0) - (b.listIndex || 0);
    });
  }

  function buildingBalanceStats(phase1, buildingKeys) {
    const rows = buildingKeys.map((key, i) => {
      const ids = phase1?.[key] || [];
      const total = midPowerOfIds(ids);
      return {
        key,
        label:
          key.startsWith('hopital')
            ? `Hôpital ${i + 1}`
            : key.startsWith('raffinerie')
              ? `Raffinerie ${i + 1}`
              : key,
        ids,
        count: ids.length,
        total,
        totalLabel: ids.length ? formatPowerMid(total) || '0 M' : 'Non affecté',
      };
    });
    const filled = rows.filter((r) => r.count > 0);
    const totals = filled.map((r) => r.total);
    const max = totals.length ? Math.max(...totals) : 0;
    const min = totals.length ? Math.min(...totals) : 0;
    const gap = totals.length ? max - min : 0;
    const average = totals.length ? totals.reduce((s, v) => s + v, 0) / totals.length : 0;
    return {
      rows,
      gap,
      average,
      averageLabel: totals.length ? formatPowerMid(average) || '—' : '—',
      gapLabel: totals.length ? formatPowerMid(gap) || '0 M' : '—',
    };
  }

  /** Place chaque joueur (déjà triés du plus fort au plus faible) sur le bâtiment le plus faible. */
  function assignToWeakestByMid(phase1, buildingKeys, playersStrongestFirst) {
    buildingKeys.forEach((key) => {
      if (!phase1[key]) phase1[key] = [];
    });
    playersStrongestFirst.forEach((player) => {
      let bestKey = buildingKeys[0];
      let bestTotal = Infinity;
      let bestCount = Infinity;
      buildingKeys.forEach((key) => {
        const total = midPowerOfIds(phase1[key]);
        const count = (phase1[key] || []).length;
        if (
          total < bestTotal - 1e-9 ||
          (Math.abs(total - bestTotal) < 1e-9 && count < bestCount)
        ) {
          bestTotal = total;
          bestCount = count;
          bestKey = key;
        }
      });
      phase1[bestKey].push(player.id);
    });
  }

  /** Échanges entre bâtiments pour réduire l’écart max−min des totaux (valeur centrale). */
  function improveBalanceBySwaps(phase1, buildingKeys, maxPasses = 80) {
    const gapOf = () => {
      const totals = buildingKeys
        .filter((k) => (phase1[k] || []).length > 0)
        .map((k) => midPowerOfIds(phase1[k]));
      if (totals.length < 2) return 0;
      return Math.max(...totals) - Math.min(...totals);
    };

    let passes = 0;
    let improved = true;
    while (improved && passes < maxPasses) {
      improved = false;
      passes += 1;
      const currentGap = gapOf();
      outer: for (let a = 0; a < buildingKeys.length; a += 1) {
        for (let b = a + 1; b < buildingKeys.length; b += 1) {
          const ka = buildingKeys[a];
          const kb = buildingKeys[b];
          const lista = phase1[ka] || [];
          const listb = phase1[kb] || [];
          for (let i = 0; i < lista.length; i += 1) {
            for (let j = 0; j < listb.length; j += 1) {
              const tmp = lista[i];
              lista[i] = listb[j];
              listb[j] = tmp;
              const newGap = gapOf();
              if (newGap + 1e-9 < currentGap) {
                improved = true;
                break outer;
              }
              listb[j] = lista[i];
              lista[i] = tmp;
            }
          }
        }
      }
    }
  }

  function generateStrategy() {
    const team = getTeam();
    const participants = sortByPowerStable(getSelectedPlayers(team, 'participant'));
    if (!participants.length) {
      AppUI.toast('Aucun participant sélectionné.');
      return null;
    }

    // Volants : inchangé (préférés puis complément, max selon effectif)
    const volants = pickVolants(participants);
    const volantIds = new Set(volants.map((v) => v.id));
    let pool = sortByMidPowerStable(participants.filter((p) => !volantIds.has(p.id)));

    const phase1 = emptyPhase1();
    const HOSPITAL_KEYS = ['hopital1', 'hopital2', 'hopital3', 'hopital4'];
    const RAFF_KEYS = ['raffinerie1', 'raffinerie2'];

    // Priorité Hôpitaux : meilleurs restants (jusqu’à ~2 par hôpital, H1–H4)
    const forHospitals = pool.splice(0, Math.min(8, pool.length));
    assignToWeakestByMid(phase1, HOSPITAL_KEYS, forHospitals);
    improveBalanceBySwaps(phase1, HOSPITAL_KEYS);

    // Raffineries ensuite (meilleurs restants), équilibrage 1 vs 2
    const forRaff = pool.splice(0, Math.min(4, pool.length));
    if (forRaff.length) {
      assignToWeakestByMid(phase1, RAFF_KEYS, forRaff);
      improveBalanceBySwaps(phase1, RAFF_KEYS);
    }

    // Pôle scientifique (règle existante : viser 2)
    const forPole = pool.splice(0, Math.min(2, pool.length));
    phase1.pole = forPole.map((p) => p.id);

    // Centre d'information en dernier (viser 2)
    const forCentre = pool.splice(0, Math.min(2, pool.length));
    phase1.centre = forCentre.map((p) => p.id);

    // Excédents : renforcer l’hôpital actuellement le plus faible (H1–H4)
    while (pool.length) {
      const next = pool.shift();
      assignToWeakestByMid(phase1, HOSPITAL_KEYS, [next]);
    }
    improveBalanceBySwaps(phase1, HOSPITAL_KEYS);
    if ((phase1.raffinerie1 || []).length || (phase1.raffinerie2 || []).length) {
      improveBalanceBySwaps(phase1, RAFF_KEYS);
    }

    // Phase 2 : max 3 volants → Silo / Arsenal / Usine (pas de 4e soutien auto)
    const phase2 = {
      silo: volants[0] ? [volants[0].id] : [],
      arsenal: volants[1] ? [volants[1].id] : [],
      usine: volants[2] ? [volants[2].id] : [],
      soutien: [],
    };

    const strategy = {
      generatedAt: new Date().toISOString(),
      volantIds: volants.map((v) => v.id),
      phase1,
      phase2,
      assignments: {},
    };

    participants.forEach((p) => {
      strategy.assignments[p.id] = { phase1: null, phase2: null, volant: false };
    });
    volants.forEach((v, i) => {
      strategy.assignments[v.id] = {
        phase1: null,
        phase2: PHASE2_BUILDINGS[i]?.key || null,
        volant: true,
        volantIndex: i + 1,
      };
    });
    Object.entries(phase1).forEach(([building, ids]) => {
      ids.forEach((id) => {
        if (!strategy.assignments[id]) {
          strategy.assignments[id] = { phase1: null, phase2: null, volant: false };
        }
        strategy.assignments[id].phase1 = building;
      });
    });

    return strategy;
  }

  function powerOfIds(ids) {
    return ids.reduce((sum, id) => sum + heroPower(getPlayerById(id)), 0);
  }

  function syncPhase2FromVolants(strategy) {
    const volants = strategy.volantIds || [];
    strategy.phase2 = {
      silo: volants[0] ? [volants[0]] : [],
      arsenal: volants[1] ? [volants[1]] : [],
      usine: volants[2] ? [volants[2]] : [],
      soutien: volants[3] ? [volants[3]] : [],
    };
  }

  function rebuildAssignments(strategy, participants) {
    const assignments = {};
    (participants || []).forEach((p) => {
      assignments[p.id] = { phase1: null, phase2: null, volant: false };
    });
    (strategy.volantIds || []).forEach((id, i) => {
      assignments[id] = {
        phase1: null,
        phase2: PHASE2_BUILDINGS[i]?.key || null,
        volant: true,
        volantIndex: i + 1,
      };
    });
    Object.entries(strategy.phase1 || {}).forEach(([building, ids]) => {
      (ids || []).forEach((id) => {
        if (!assignments[id]) assignments[id] = { phase1: null, phase2: null, volant: false };
        if (assignments[id].volant) return;
        assignments[id].phase1 = building;
      });
    });
    strategy.assignments = assignments;
    syncPhase2FromVolants(strategy);
  }

  function clearPlayerFromStrategy(strategy, playerId) {
    strategy.volantIds = (strategy.volantIds || []).filter((id) => id !== playerId);
    Object.keys(strategy.phase1 || {}).forEach((key) => {
      strategy.phase1[key] = (strategy.phase1[key] || []).filter((id) => id !== playerId);
    });
  }

  function getPlayerAssignmentPlaces(strategy, playerId) {
    const places = [];
    if ((strategy.volantIds || []).includes(playerId)) places.push('Volants');
    PHASE1_BUILDINGS.forEach((b) => {
      const ids = strategy.phase1?.[b.key] || [];
      const count = ids.filter((id) => id === playerId).length;
      for (let i = 0; i < count; i += 1) places.push(b.label);
    });
    return places;
  }

  function collectControlIssues(team) {
    const strategy = team.strategy;
    const issues = {
      duplicates: [],
      forgotten: [],
      remplacantAssigned: [],
      unavailableAssigned: [],
      alerts: [],
      blocking: false,
    };
    if (!strategy) return issues;

    const participants = getSelectedPlayers(team, 'participant');
    const remplacantIds = new Set(getSelectedPlayers(team, 'remplacant').map((p) => p.id));
    const participantIds = new Set(participants.map((p) => p.id));
    const seen = new Map();

    const notePlace = (playerId, place) => {
      if (!seen.has(playerId)) seen.set(playerId, []);
      seen.get(playerId).push(place);
    };

    (strategy.volantIds || []).forEach((id) => notePlace(id, 'Volants'));
    PHASE1_BUILDINGS.forEach((b) => {
      (strategy.phase1?.[b.key] || []).forEach((id) => notePlace(id, b.label));
    });

    seen.forEach((places, playerId) => {
      const player = getPlayerById(playerId);
      const pseudo = player?.pseudo || playerId;
      if (places.length > 1) {
        const uniqPlaces = [...new Set(places)];
        issues.duplicates.push({
          playerId,
          pseudo,
          places: uniqPlaces,
        });
        issues.alerts.push(
          `Doublon : ${pseudo} est affecté à ${uniqPlaces.join(' · ')}.`
        );
      }
      if (remplacantIds.has(playerId)) {
        issues.remplacantAssigned.push({ playerId, pseudo, places });
        issues.alerts.push(
          `Remplaçant affecté : ${pseudo} (${[...new Set(places)].join(' · ')}).`
        );
      }
      const roster = ensureRosterEntry(team, playerId);
      if (roster.availability === 'indisponible') {
        issues.unavailableAssigned.push({ playerId, pseudo, places });
        issues.alerts.push(
          `Joueur indisponible affecté : ${pseudo} (${[...new Set(places)].join(' · ')}).`
        );
      }
    });

    participants.forEach((p) => {
      const places = seen.get(p.id) || [];
      if (!places.length) {
        issues.forgotten.push({ playerId: p.id, pseudo: p.pseudo });
        issues.alerts.push(`Joueur oublié : ${p.pseudo} (ni volant ni bâtiment).`);
      }
    });

    // Participants uniquement pour « oublié » ; IDs hors liste restent signalés via doublons éventuels
    void participantIds;

    issues.blocking = issues.duplicates.length > 0 || issues.forgotten.length > 0;
    return issues;
  }

  function analyzeStrategy(team) {
    const participants = getSelectedPlayers(team, 'participant');
    const remplacants = getSelectedPlayers(team, 'remplacant');
    const strategy = team.strategy;
    const alerts = [];
    if (!strategy) {
      return {
        participants: participants.length,
        remplacants: remplacants.length,
        volants: 0,
        alerts: ['Aucune stratégie générée.'],
        buildingAverages: [],
        hospitals: {},
        hospitalBalance: null,
        raffineryBalance: null,
        controls: { blocking: false, alerts: [] },
      };
    }

    const volantIds = strategy.volantIds || [];
    const buildingAverages = ASSIGNMENT_ROWS.map((row) => {
      const ids = row.kind === 'volant' ? volantIds : strategy.phase1?.[row.key] || [];
      const avg = averageMidOfIds(ids);
      return {
        key: row.key,
        label: row.label,
        ids,
        count: ids.length,
        average: avg,
        averageLabel: ids.length ? formatPowerMid(avg) || 'Non renseignée' : 'Non affecté',
      };
    });

    const hospitalBalance = buildingBalanceStats(strategy.phase1, [
      'hopital1',
      'hopital2',
      'hopital3',
      'hopital4',
    ]);
    const raffineryBalance = buildingBalanceStats(strategy.phase1, ['raffinerie1', 'raffinerie2']);

    const hospitals = {};
    hospitalBalance.rows.forEach((h) => {
      hospitals[h.key] = {
        label: h.label,
        ids: h.ids,
        power: h.total,
        count: h.count,
        totalLabel: h.totalLabel,
      };
    });

    if (hospitalBalance.rows.some((h) => h.count > 0) && hospitalBalance.gap > 10) {
      alerts.push(
        `Écart Hôpitaux trop élevé : ${hospitalBalance.gapLabel} entre le plus fort et le plus faible (seuil 10 M).`
      );
    }
    if (raffineryBalance.rows.some((r) => r.count > 0) && raffineryBalance.gap > 10) {
      alerts.push(
        `Écart Raffineries trop élevé : ${raffineryBalance.gapLabel} entre Raffinerie 1 et 2 (seuil 10 M).`
      );
    }

    const filledAvgs = buildingAverages.filter((b) => b.count > 0 && b.average);
    const totalAvgSum = filledAvgs.reduce((sum, b) => sum + b.average * b.count, 0);
    if (totalAvgSum > 0) {
      filledAvgs.forEach((b) => {
        const share = (b.average * b.count) / totalAvgSum;
        if (share > 0.4) {
          alerts.push(`Toute la puissance est concentrée sur ${b.label}.`);
        }
      });
    }

    const controls = collectControlIssues(team);
    controls.alerts.forEach((a) => alerts.push(a));

    if (!alerts.length) alerts.push('Équilibres acceptables.');

    return {
      participants: participants.length,
      remplacants: remplacants.length,
      volants: volantIds.length,
      alerts,
      buildingAverages,
      hospitals,
      hospitalBalance,
      raffineryBalance,
      controls,
      phase1: strategy.phase1,
      phase2: strategy.phase2,
    };
  }

  function applyStrategyMutation(mutator) {
    update((s) => {
      const team = s.teams[s.activeTeam];
      if (!team.strategy) return s;
      mutator(team.strategy, team);
      rebuildAssignments(team.strategy, getSelectedPlayers(team, 'participant'));
      team.mail = '';
      return s;
    });
  }

  function addPlayerToRow(rowKey, playerId) {
    if (!playerId) return;
    applyStrategyMutation((strategy) => {
      if (rowKey === 'volants') {
        const current = strategy.volantIds || [];
        if (current.includes(playerId)) return;
        if (current.length >= 3) {
          AppUI.toast('Maximum 3 volants.');
          return;
        }
        clearPlayerFromStrategy(strategy, playerId);
        strategy.volantIds = [...(strategy.volantIds || []), playerId];
        return;
      }
      clearPlayerFromStrategy(strategy, playerId);
      if (!strategy.phase1[rowKey]) strategy.phase1[rowKey] = [];
      strategy.phase1[rowKey].push(playerId);
    });
  }

  function removePlayerFromRow(rowKey, playerId) {
    applyStrategyMutation((strategy) => {
      if (rowKey === 'volants') {
        strategy.volantIds = (strategy.volantIds || []).filter((id) => id !== playerId);
      } else if (strategy.phase1?.[rowKey]) {
        strategy.phase1[rowKey] = strategy.phase1[rowKey].filter((id) => id !== playerId);
      }
    });
  }

  function replacePlayerInRow(rowKey, oldPlayerId, newPlayerId) {
    if (!newPlayerId || !oldPlayerId || newPlayerId === oldPlayerId) return;
    applyStrategyMutation((strategy) => {
      if (rowKey === 'volants') {
        const list = strategy.volantIds || [];
        if (!list.includes(oldPlayerId)) return;
        clearPlayerFromStrategy(strategy, newPlayerId);
        strategy.volantIds = (strategy.volantIds || []).map((id) =>
          id === oldPlayerId ? newPlayerId : id
        );
        return;
      }
      const list = strategy.phase1?.[rowKey] || [];
      if (!list.includes(oldPlayerId)) return;
      clearPlayerFromStrategy(strategy, newPlayerId);
      strategy.phase1[rowKey] = (strategy.phase1[rowKey] || []).map((id) =>
        id === oldPlayerId ? newPlayerId : id
      );
    });
  }

  function buildMail(teamKey) {
    const s = getState();
    const team = s.teams[teamKey];
    const hour = s.hours[teamKey];
    const strategy = team.strategy;
    if (!strategy) return '';

    const name = (id) => getPlayerById(id)?.pseudo || '—';
    const list = (ids) => (ids && ids.length ? ids.map(name).join(', ') : '—');
    const remplacants = getSelectedPlayers(team, 'remplacant').map((p) => p.pseudo);

    const volantLines = (strategy.volantIds || [])
      .map((id, i) => {
        const roles = ['Silo', 'Arsenal', 'Usine de mercenaires', 'Soutien mobile'];
        return `Volant ${i + 1} : ${name(id)} → ${roles[i] || '—'}`;
      })
      .join('\n');

    const p1 = strategy.phase1 || {};
    const lines = [
      `TEMPÊTE DU DÉSERT — Équipe ${teamKey}`,
      `Horaire : ${hour}`,
      '',
      '— VOLANTS —',
      volantLines || '—',
      '',
      '— PHASE 1 —',
      `Hôpital 1 : ${list(p1.hopital1)}`,
      `Hôpital 2 : ${list(p1.hopital2)}`,
      `Hôpital 3 : ${list(p1.hopital3)}`,
      `Hôpital 4 : ${list(p1.hopital4)}`,
      `Pôle scientifique : ${list(p1.pole)}`,
      `Raffinerie 1 : ${list(p1.raffinerie1)}`,
      `Raffinerie 2 : ${list(p1.raffinerie2)}`,
      `Centre d'information : ${list(p1.centre)}`,
      '',
      '— TRANSITION PHASE 2 —',
      'Ne jamais abandonner les Hôpitaux, le Pôle scientifique ni les Raffineries.',
      `Silo : ${list(strategy.phase2?.silo)}`,
      `Arsenal : ${list(strategy.phase2?.arsenal)}`,
      `Usine de mercenaires : ${list(strategy.phase2?.usine)}`,
      `Soutien mobile : ${list(strategy.phase2?.soutien)}`,
      '',
      '— REMPLAÇANTS —',
      remplacants.length ? remplacants.join(', ') : '—',
      '',
      '— RAPPELS —',
      'Espionner avant d’attaquer.',
      'Défendre son bâtiment.',
      'Demander de l’aide.',
      'Envoyer sa position.',
      'Ne jamais abandonner un bâtiment.',
      'Les pertes reviennent après la Tempête.',
      'Défendre les bâtiments est plus important que courir au Silo.',
      'Chaque rôle est indispensable.',
    ];
    return lines.join('\n');
  }

  /* ---------- DOM ---------- */

  function cacheDom() {
    els.root = document.getElementById('panel-tempete');
    els.activeTeam = document.getElementById('tempeteActiveTeam');
    els.hourA = document.getElementById('tempeteHourA');
    els.hourB = document.getElementById('tempeteHourB');
    els.playersBody = document.getElementById('tempetePlayersBody');
    els.playersEmpty = document.getElementById('tempetePlayersEmpty');
    els.selectionSummary = document.getElementById('tempeteSelectionSummary');
    els.suggestions = document.getElementById('tempeteSuggestions');
    els.btnResetAvailability = document.getElementById('tempeteResetAvailability');
    els.btnSuggestRemplacants = document.getElementById('tempeteSuggestRemplacants');
    els.btnGenerateMail = document.getElementById('tempeteGenerateMail');
    els.btnCopyMail = document.getElementById('tempeteCopyMail');
    els.stormCards = document.getElementById('tempeteStormCards');
    els.strategyTitle = document.getElementById('tempeteStrategyTitle');
    els.strategySubtitle = document.getElementById('tempeteStrategySubtitle');
    els.analysis = document.getElementById('tempeteAnalysis');
    els.assignments = document.getElementById('tempeteAssignments');
    els.mailBlock = document.getElementById('tempeteMailBlock');
    els.mailText = document.getElementById('tempeteMailText');
    els.mailFeedback = document.getElementById('tempeteMailFeedback');
    els.archivesList = document.getElementById('tempeteArchivesList');
    els.archivesEmpty = document.getElementById('tempeteArchivesEmpty');
    els.btnOpenSelection = document.getElementById('tempeteOpenSelection');
    els.selectionModal = document.getElementById('tempeteSelectionModal');
    els.selectionBody = document.getElementById('tempeteSelectionBody');
    els.selectionEmpty = document.getElementById('tempeteSelectionEmpty');
    els.presenceModal = document.getElementById('tempetePresenceModal');
    els.presenceTitle = document.getElementById('tempetePresenceTitle');
    els.presenceBody = document.getElementById('tempetePresenceBody');
    els.rosterModal = document.getElementById('tempeteRosterModal');
    els.rosterModalTitle = document.getElementById('tempeteRosterModalTitle');
    els.rosterModalHint = document.getElementById('tempeteRosterModalHint');
    els.rosterModalBody = document.getElementById('tempeteRosterModalBody');
    els.rosterModalTotal = document.getElementById('tempeteRosterModalTotal');
    els.rosterModalCancel = document.getElementById('tempeteRosterModalCancel');
    els.rosterModalConfirm = document.getElementById('tempeteRosterModalConfirm');
    els.rosterModalX = document.getElementById('tempeteRosterModalX');
  }

  function renderPlayers() {
    if (!els.playersBody) return;
    const teamKey = activeTeamKey();
    const team = getTeam(teamKey);
    const players = getActivePlayers();
    if (!players.length) {
      els.playersBody.innerHTML = '';
      els.playersEmpty?.classList.remove('hidden');
      return;
    }
    els.playersEmpty?.classList.add('hidden');

    els.playersBody.innerHTML = players
      .map((p) => {
        const entry = ensureRosterEntry(team, p.id);
        const assignment = getStormAssignment(p.id);
        const lockedElsewhere = isAssignedOnOtherTeam(p.id, teamKey);
        const availOpts = Object.entries(AVAIL)
          .map(
            ([k, label]) =>
              `<option value="${k}" ${entry.availability === k ? 'selected' : ''}>${label}</option>`
          )
          .join('');
        const selOpts = Object.entries(SELECT)
          .map(([k, label]) => {
            const disableRole =
              lockedElsewhere && (k === 'participant' || k === 'remplacant');
            return `<option value="${k}" ${entry.selection === k ? 'selected' : ''}${
              disableRole ? ' disabled' : ''
            }>${label}</option>`;
          })
          .join('');
        const lockHint = lockedElsewhere
          ? `<div class="tempete-assign-locked">Déjà affecté en Équipe ${assignment.team}</div>`
          : '';
        return `
          <tr data-player="${p.id}">
            <td><strong>${escapeHtml(p.pseudo)}</strong>${p.preferredVolant ? ' <span class="chip muted">Volant</span>' : ''}</td>
            <td>${escapeHtml(heroPowerLabel(p))}</td>
            <td>
              <select class="input" data-tempete-field="availability" data-player="${p.id}">${availOpts}</select>
            </td>
            <td>
              <select class="input" data-tempete-field="selection" data-player="${p.id}"${
                lockedElsewhere ? ' title="Déjà affecté dans l’autre équipe"' : ''
              }>${selOpts}</select>
              ${lockHint}
            </td>
            <td>${escapeHtml(assignment.label)}</td>
          </tr>
        `;
      })
      .join('');

    const nP = countSelection(team, 'participant');
    const nR = countSelection(team, 'remplacant');
    if (els.selectionSummary) {
      els.selectionSummary.textContent = `Participants : ${nP} / 20 · Remplaçants : ${nR} / 10 · Volants prévus : ${volantCountFor(nP)}`;
    }
  }

  function updateActionButtonsState() {
    const team = getTeam();
    const teamKey = activeTeamKey();
    const controls = team.strategy ? collectControlIssues(team) : { blocking: false };
    const blocked = Boolean(controls.blocking);

    if (els.btnGenerateMail) {
      els.btnGenerateMail.disabled = blocked || !team.strategy;
      els.btnGenerateMail.title = blocked
        ? 'Corrigez les doublons et joueurs oubliés avant de générer le mail.'
        : !team.strategy
          ? 'Générez d’abord la stratégie de cette Tempête.'
          : '';
    }
    if (els.strategyTitle) els.strategyTitle.textContent = `Stratégie — Tempête ${teamKey}`;
    if (els.strategySubtitle) {
      els.strategySubtitle.textContent = team.strategy
        ? `Détail de la Tempête ${teamKey}`
        : `Aucune stratégie générée pour la Tempête ${teamKey}`;
    }
    renderStormCards();
  }

  function renderStormCards() {
    if (!els.stormCards) return;
    const focused = activeTeamKey();
    const hourA = getState().hours?.A || '13h';
    const hourB = getState().hours?.B || '22h';

    els.stormCards.innerHTML = ['A', 'B']
      .map((key) => {
        const team = getTeam(key);
        const count = countInscribedForTeam(key);
        const validated = isPlayersValidated(key);
        const hasStrategy = Boolean(team.strategy);
        const controls = hasStrategy ? collectControlIssues(team) : { blocking: false };
        const generateDisabled = !validated;
        const closeDisabled = !hasStrategy || Boolean(controls.blocking);
        const status = hasStrategy
          ? controls.blocking
            ? '⚠️ Stratégie à corriger'
            : '✅ Stratégie prête'
          : validated
            ? '✅ Joueurs validés'
            : 'Sélection à vérifier';
        const hour = key === 'B' ? hourB : hourA;
        return `
          <article class="tempete-storm-card ${focused === key ? 'is-focused' : ''}" data-tempete-card="${key}">
            <header class="tempete-storm-card-header">
              <h3>🌪️ Tempête ${key}</h3>
              <p class="tempete-storm-card-meta">${escapeHtml(hour)} · ${count} joueur${count > 1 ? 's' : ''}</p>
              <p class="tempete-storm-card-status">${status}</p>
            </header>
            <div class="tempete-storm-card-actions">
              <button type="button" class="btn btn-ghost" data-tempete-action="verify" data-team="${key}">
                Vérifier les joueurs
              </button>
              <button
                type="button"
                class="btn btn-primary"
                data-tempete-action="generate"
                data-team="${key}"
                ${generateDisabled ? 'disabled' : ''}
                title="${
                  generateDisabled
                    ? 'Vérifiez et validez les joueurs de cette Tempête avant de générer.'
                    : ''
                }"
              >
                Générer la stratégie
              </button>
              <button
                type="button"
                class="btn btn-primary"
                data-tempete-action="close"
                data-team="${key}"
                ${closeDisabled ? 'disabled' : ''}
                title="${
                  !hasStrategy
                    ? 'Générez une stratégie avant de clôturer.'
                    : controls.blocking
                      ? 'Corrigez les doublons et joueurs oubliés avant de clôturer.'
                      : ''
                }"
              >
                Clôturer la Tempête
              </button>
            </div>
          </article>
        `;
      })
      .join('');
  }

  function renderAnalysis() {
    if (!els.analysis) return;
    const team = getTeam();
    const analysis = analyzeStrategy(team);
    const avgLines = (analysis.buildingAverages || [])
      .map(
        (b) =>
          `<li><strong>${escapeHtml(b.label)}</strong> : ${escapeHtml(b.averageLabel)}${
            b.count ? ` · ${b.count} joueur(s)` : ''
          }</li>`
      )
      .join('');

    const hospitalLines = (analysis.hospitalBalance?.rows || [])
      .map(
        (h) =>
          `<li><strong>${escapeHtml(h.label)}</strong> : total ${escapeHtml(h.totalLabel)}${
            h.count ? ` · ${h.count} joueur(s)` : ''
          }</li>`
      )
      .join('');
    const raffLines = (analysis.raffineryBalance?.rows || [])
      .map(
        (r) =>
          `<li><strong>${escapeHtml(r.label)}</strong> : total ${escapeHtml(r.totalLabel)}${
            r.count ? ` · ${r.count} joueur(s)` : ''
          }</li>`
      )
      .join('');

    const hb = analysis.hospitalBalance;
    const rb = analysis.raffineryBalance;

    els.analysis.innerHTML = `
      <div class="block">
        <header class="block-header">
          <h3>Analyse</h3>
          <p>Équipe ${activeTeamKey()} · totaux / moyennes sur valeur centrale des tranches</p>
        </header>
        <ul class="tempete-stats">
          <li>Participants : ${analysis.participants}</li>
          <li>Remplaçants : ${analysis.remplacants}</li>
          <li>Volants : ${analysis.volants}</li>
        </ul>
        <p><strong>Équilibrage Hôpitaux</strong></p>
        <ul class="tempete-stats">
          ${hospitalLines || '<li>Aucun hôpital affecté.</li>'}
          ${
            hb
              ? `<li>Puissance moyenne des Hôpitaux : <strong>${escapeHtml(hb.averageLabel)}</strong></li>
                 <li>Écart max − min : <strong>${escapeHtml(hb.gapLabel)}</strong></li>`
              : ''
          }
        </ul>
        <p><strong>Équilibrage Raffineries</strong></p>
        <ul class="tempete-stats">
          ${raffLines || '<li>Aucune raffinerie affectée.</li>'}
          ${
            rb
              ? `<li>Écart Raffinerie 1 / 2 : <strong>${escapeHtml(rb.gapLabel)}</strong></li>`
              : ''
          }
        </ul>
        <p><strong>Puissance moyenne Phase 1 (détail)</strong></p>
        <ul class="tempete-stats">${avgLines || '<li>Aucune stratégie générée.</li>'}</ul>
        <p><strong>Alertes</strong></p>
        <ul class="tempete-alerts">${analysis.alerts.map((a) => `<li>${escapeHtml(a)}</li>`).join('')}</ul>
      </div>
    `;
    updateActionButtonsState();
  }

  function participantOptionsHtml(participants, excludeIds = []) {
    const excluded = new Set(excludeIds);
    return participants
      .filter((p) => !excluded.has(p.id))
      .map(
        (p) =>
          `<option value="${p.id}">${escapeHtml(p.pseudo)} · ${escapeHtml(heroPowerLabel(p))}</option>`
      )
      .join('');
  }

  function renderAssignments() {
    if (!els.assignments) return;
    const team = getTeam();
    const strategy = team.strategy;
    if (!strategy) {
      els.assignments.innerHTML = '<p class="empty-state">Générez une stratégie pour voir les affectations.</p>';
      updateActionButtonsState();
      return;
    }

    const participants = getSelectedPlayers(team, 'participant');
    const analysis = analyzeStrategy(team);
    const avgByKey = Object.fromEntries(
      (analysis.buildingAverages || []).map((b) => [b.key, b.averageLabel])
    );

    const rows = ASSIGNMENT_ROWS.map((row) => {
      const ids = row.kind === 'volant' ? strategy.volantIds || [] : strategy.phase1?.[row.key] || [];
      const playersHtml = ids.length
        ? ids
            .map((id) => {
              const p = getPlayerById(id);
              const phase2 =
                row.kind === 'volant'
                  ? PHASE2_BUILDINGS[(strategy.volantIds || []).indexOf(id)]?.label
                  : null;
              return `
                <div style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:0.45rem;align-items:center;padding:0.35rem 0;border-bottom:1px solid var(--border-soft)">
                  <div>
                    <strong>${escapeHtml(p?.pseudo || id)}</strong>
                    <span class="panel-subtitle"> · ${escapeHtml(heroPowerLabel(p))}${
                      phase2 ? ` · Phase 2 : ${escapeHtml(phase2)}` : ''
                    }</span>
                  </div>
                  <div style="display:flex;flex-wrap:wrap;gap:0.35rem;align-items:center">
                    <select class="input input-sm" data-tempete-replace-row="${row.key}" data-tempete-replace-old="${id}" aria-label="Remplacer ${escapeHtml(p?.pseudo || '')}">
                      <option value="">Remplacer…</option>
                      ${participantOptionsHtml(participants, [id])}
                    </select>
                    <button type="button" class="btn btn-ghost btn-sm" data-tempete-remove-row="${row.key}" data-tempete-remove-player="${id}">Retirer</button>
                  </div>
                </div>
              `;
            })
            .join('')
        : '<p class="panel-subtitle" style="margin:0">Non affecté</p>';

      return `
        <tr>
          <td><strong>${escapeHtml(row.label)}</strong></td>
          <td>${playersHtml}</td>
          <td>${escapeHtml(avgByKey[row.key] || 'Non affecté')}</td>
          <td>
            <select class="input" data-tempete-add-row="${row.key}" aria-label="Ajouter à ${escapeHtml(row.label)}">
              <option value="">Ajouter…</option>
              ${participantOptionsHtml(participants, ids)}
            </select>
          </td>
        </tr>
      `;
    }).join('');

    els.assignments.innerHTML = `
      <div class="block">
        <header class="block-header">
          <h3>Affectations Phase 1</h3>
          <p>Par bâtiment — modifications recalculées immédiatement</p>
        </header>
        <div class="table-wrap">
          <table class="archive-table" style="vertical-align:top">
            <thead>
              <tr>
                <th>Bâtiment</th>
                <th>Joueurs · tranche</th>
                <th>Moyenne</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
    `;
    updateActionButtonsState();
  }

  function renderMail() {
    if (!els.mailBlock) return;
    const team = getTeam();
    if (!team.mail) {
      els.mailBlock.classList.add('hidden');
      if (els.btnCopyMail) els.btnCopyMail.disabled = true;
      return;
    }
    els.mailBlock.classList.remove('hidden');
    els.mailText.textContent = team.mail;
    if (els.btnCopyMail) els.btnCopyMail.disabled = false;
    els.mailFeedback?.classList.add('hidden');
  }

  function renderAttendance() {
    // Ancienne liste inline retirée — la clôture passe par la fenêtre commune.
  }

  function playerListHtml(players, options = {}) {
    const { withStatus = false, attendanceMap = {} } = options;
    if (!players.length) {
      return `<li class="tempete-roster-empty">Aucun</li>`;
    }
    return players
      .map((p) => {
        if (!withStatus) {
          return `<li><strong>${escapeHtml(p.pseudo)}</strong></li>`;
        }
        const current = attendanceMap[p.id] || 'present';
        const opts = Object.keys(ATTEND_UI)
          .map(
            (k) =>
              `<option value="${k}" ${current === k ? 'selected' : ''}>${ATTEND_UI[k]}</option>`
          )
          .join('');
        return `
          <li>
            <strong>${escapeHtml(p.pseudo)}</strong>
            <select class="input tempete-roster-status" data-tempete-close-status="${p.id}" aria-label="Statut ${escapeHtml(
              p.pseudo
            )}">${opts}</select>
          </li>
        `;
      })
      .join('');
  }

  function teamRosterSectionHtml(teamKey, options = {}) {
    const team = getTeam(teamKey);
    const participants = getSelectedPlayers(team, 'participant');
    const remplacants = getSelectedPlayers(team, 'remplacant');
    return `
      <section class="tempete-roster-team">
        <h4>Tempête ${teamKey}</h4>
        <div class="tempete-roster-section">
          <p class="tempete-roster-section-title">Participants</p>
          <ul class="tempete-roster-list">${playerListHtml(participants, options)}</ul>
        </div>
        <div class="tempete-roster-section">
          <p class="tempete-roster-section-title">Remplaçants</p>
          <ul class="tempete-roster-list">${playerListHtml(remplacants, options)}</ul>
        </div>
      </section>
    `;
  }

  function countInscribedForTeam(teamKey) {
    const team = getTeam(teamKey);
    return (
      countSelection(team, 'participant') + countSelection(team, 'remplacant')
    );
  }

  function renderRosterModalContent() {
    if (!els.rosterModalBody) return;
    const teamKey = rosterModalTeam === 'B' ? 'B' : 'A';

    if (rosterModalMode === 'verify') {
      if (els.rosterModalTitle) els.rosterModalTitle.textContent = `Vérifier les joueurs — Tempête ${teamKey}`;
      if (els.rosterModalHint) {
        els.rosterModalHint.textContent =
          'Comparez cette liste avec les inscrits dans Last War. Aucune modification ici.';
      }
      if (els.rosterModalCancel) els.rosterModalCancel.textContent = '⬅ Retour';
      if (els.rosterModalConfirm) els.rosterModalConfirm.textContent = '✅ Valider';

      els.rosterModalBody.innerHTML = teamRosterSectionHtml(teamKey);
      const total = countInscribedForTeam(teamKey);
      if (els.rosterModalTotal) {
        els.rosterModalTotal.textContent = `Nombre total de joueurs : ${total}`;
      }
      return;
    }

    if (rosterModalMode === 'close') {
      if (els.rosterModalTitle) els.rosterModalTitle.textContent = `Clôturer la Tempête ${teamKey}`;
      if (els.rosterModalHint) {
        els.rosterModalHint.textContent =
          'Par défaut tous les joueurs sont présents. Modifiez uniquement les absents.';
      }
      if (els.rosterModalCancel) els.rosterModalCancel.textContent = '⬅ Annuler';
      if (els.rosterModalConfirm) {
        els.rosterModalConfirm.textContent = `✅ Clôturer la Tempête ${teamKey}`;
      }

      els.rosterModalBody.innerHTML = teamRosterSectionHtml(teamKey, {
        withStatus: true,
        attendanceMap: closeAttendanceDraft,
      });
      const total = countInscribedForTeam(teamKey);
      if (els.rosterModalTotal) {
        els.rosterModalTotal.textContent = `Nombre total de joueurs : ${total}`;
      }
    }
  }

  function openVerifyPlayersModal(teamKey = activeTeamKey()) {
    rosterModalTeam = teamKey === 'B' ? 'B' : 'A';
    setActiveTeam(rosterModalTeam);
    rosterModalMode = 'verify';
    closeAttendanceDraft = {};
    renderRosterModalContent();
    els.rosterModal?.showModal();
  }

  function openCloseStormModal(teamKey = activeTeamKey()) {
    rosterModalTeam = teamKey === 'B' ? 'B' : 'A';
    setActiveTeam(rosterModalTeam);
    const team = getTeam(rosterModalTeam);
    const inscribed = [
      ...getSelectedPlayers(team, 'participant'),
      ...getSelectedPlayers(team, 'remplacant'),
    ];
    closeAttendanceDraft = {};
    inscribed.forEach((p) => {
      closeAttendanceDraft[p.id] = 'present';
    });
    rosterModalMode = 'close';
    renderRosterModalContent();
    els.rosterModal?.showModal();
  }

  function closeRosterModal() {
    rosterModalMode = null;
    closeAttendanceDraft = {};
    if (els.rosterModal?.open) els.rosterModal.close();
  }

  function onValidatePlayers() {
    const teamKey = rosterModalTeam === 'B' ? 'B' : 'A';
    update((s) => {
      if (!s.teamValidation) s.teamValidation = createBlankTeamValidation();
      s.teamValidation[teamKey] = {
        validated: true,
        fingerprint: getTeamRosterFingerprint(teamKey),
      };
      s.activeTeam = teamKey;
      return s;
    });
    closeRosterModal();
    AppUI.toast(`Tempête ${teamKey} : joueurs validés — génération disponible.`);
  }

  function renderArchives() {
    if (!els.archivesList) return;
    const archives = getState().archives;
    if (!archives.length) {
      els.archivesList.innerHTML = '';
      els.archivesEmpty?.classList.remove('hidden');
      return;
    }
    els.archivesEmpty?.classList.add('hidden');
    els.archivesList.innerHTML = archives
      .map((a) => {
        const date = a.closedAt ? new Date(a.closedAt).toLocaleString('fr-FR') : '—';
        const by =
          global.ROSProfiles && typeof ROSProfiles.resolveActor === 'function'
            ? ROSProfiles.resolveActor(a)
            : a.closedBy || '';
        const byLabel = by && by !== '—' ? ` · par ${by}` : '';
        return `
          <article class="stack-item">
            <div class="stack-item-main">
              <h4 class="stack-item-title">Équipe ${escapeHtml(a.team)} · ${escapeHtml(a.hour || '')}</h4>
              <p class="panel-subtitle">${escapeHtml(date)}${escapeHtml(byLabel)} · ${a.participants?.length || 0} participants · ${a.remplacants?.length || 0} remplaçants</p>
            </div>
            <button type="button" class="btn btn-ghost btn-sm" data-tempete-archive="${a.id}">Voir</button>
          </article>
        `;
      })
      .join('');
  }

  function matchesPresenceFilter(percent) {
    if (presenceFilter === 'all') return true;
    if (percent == null || !Number.isFinite(percent)) return false;
    if (presenceFilter === 'high') return percent >= 90;
    if (presenceFilter === 'mid') return percent >= 75 && percent <= 89;
    if (presenceFilter === 'low') return percent < 75;
    return true;
  }

  function renderSelectionModal() {
    if (!els.selectionBody) return;
    const players = getActivePlayers()
      .map((p) => {
        const history = getPlayerPresenceHistory(p.id, 20);
        return {
          id: p.id,
          pseudo: p.pseudo,
          powerLabel: formatSelectionPower(p),
          percent: history.percent,
        };
      })
      .filter((p) => matchesPresenceFilter(p.percent))
      .sort((a, b) => {
        const pa = a.percent == null ? -1 : a.percent;
        const pb = b.percent == null ? -1 : b.percent;
        if (pb !== pa) return pb - pa;
        return a.pseudo.localeCompare(b.pseudo, 'fr', { sensitivity: 'base' });
      });

    document.querySelectorAll('[data-tempete-presence-filter]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.tempetePresenceFilter === presenceFilter);
    });

    if (!players.length) {
      els.selectionBody.innerHTML = '';
      els.selectionEmpty?.classList.remove('hidden');
      return;
    }
    els.selectionEmpty?.classList.add('hidden');
    els.selectionBody.innerHTML = players
      .map((p) => {
        const color = presenceColorClass(p.percent);
        const label = formatPresencePercent(p.percent);
        const clickable =
          p.percent == null
            ? `<span class="tempete-presence-pct ${color}">${escapeHtml(label)}</span>`
            : `<button type="button" class="tempete-presence-pct ${color}" data-tempete-presence-detail="${p.id}">${escapeHtml(
                label
              )}</button>`;
        return `
          <tr>
            <td><strong>${escapeHtml(p.pseudo)}</strong></td>
            <td>${escapeHtml(p.powerLabel)}</td>
            <td>${clickable}</td>
          </tr>
        `;
      })
      .join('');
  }

  function openSelectionModal() {
    presenceFilter = 'all';
    renderSelectionModal();
    els.selectionModal?.showModal();
  }

  function closeSelectionModal() {
    if (els.selectionModal?.open) els.selectionModal.close();
  }

  function openPresenceDetail(playerId) {
    const player = getPlayerById(playerId);
    const history = getPlayerPresenceHistory(playerId, 20);
    if (els.presenceTitle) {
      els.presenceTitle.textContent = `Historique Tempête${player ? ` — ${player.pseudo}` : ''}`;
    }
    if (els.presenceBody) {
      const pct = formatPresencePercent(history.percent);
      const color = presenceColorClass(history.percent);
      els.presenceBody.innerHTML = `
        <p class="panel-subtitle" style="margin-top:0">${history.total} participation${
          history.total > 1 ? 's' : ''
        }</p>
        <ul class="tempete-stats">
          <li>Présent : <strong>${history.present}</strong></li>
          <li>Absence excusée : <strong>${history.absentExcuse}</strong></li>
          <li>Absence non excusée : <strong>${history.absent}</strong></li>
          <li>Présence : <strong class="tempete-presence-pct ${color}">${escapeHtml(pct)}</strong></li>
        </ul>
      `;
    }
    els.presenceModal?.showModal();
  }

  function closePresenceModal() {
    if (els.presenceModal?.open) els.presenceModal.close();
  }

  function renderHours() {
    const s = getState();
    if (els.activeTeam) els.activeTeam.value = s.activeTeam;
    if (els.hourA) els.hourA.value = s.hours.A;
    if (els.hourB) els.hourB.value = s.hours.B;
  }

  function render() {
    if (!els.root) return;
    // Garde les validations cohérentes avec chaque sélection
    const s0 = getState();
    if (!s0.teamValidation) s0.teamValidation = createBlankTeamValidation();
    let stale = false;
    ['A', 'B'].forEach((key) => {
      const row = s0.teamValidation[key];
      if (row?.validated && row.fingerprint !== getTeamRosterFingerprint(key)) {
        stale = true;
      }
    });
    if (stale) {
      update((s) => {
        ['A', 'B'].forEach((key) => {
          const row = s.teamValidation?.[key];
          if (row?.validated && row.fingerprint !== getTeamRosterFingerprint(key)) {
            clearTeamValidation(s, key);
          }
        });
        return s;
      });
      return;
    }
    renderHours();
    renderPlayers();
    renderAnalysis();
    renderAssignments();
    renderMail();
    renderArchives();
    updateActionButtonsState();
  }

  function setRosterField(playerId, field, value) {
    update((s) => {
      const teamKey = s.activeTeam === 'B' ? 'B' : 'A';
      const team = s.teams[teamKey];
      const entry = ensureRosterEntry(team, playerId);
      if (field === 'selection') {
        if (value === 'participant' || value === 'remplacant') {
          const other = oppositeTeamKey(teamKey);
          const otherEntry = s.teams[other]?.roster?.[playerId];
          const otherSel = otherEntry ? normalizeRosterEntry(otherEntry).selection : 'non_retenu';
          if (otherSel === 'participant' || otherSel === 'remplacant') {
            AppUI.toast(`Déjà affecté en Tempête ${other}`);
            return s;
          }
        }
        if (value === 'participant' && countSelection(team, 'participant') >= 20 && entry.selection !== 'participant') {
          AppUI.toast('Maximum 20 participants.');
          return s;
        }
        if (value === 'remplacant' && countSelection(team, 'remplacant') >= 10 && entry.selection !== 'remplacant') {
          AppUI.toast('Maximum 10 remplaçants.');
          return s;
        }
        const previous = entry.selection;
        entry.selection = value;
        if (previous !== value) {
          clearTeamValidation(s, teamKey);
        }
        // Invalider stratégie si la sélection change
        team.strategy = null;
        team.mail = '';
      } else if (field === 'availability') {
        entry.availability = Object.keys(AVAIL).includes(value) ? value : 'indisponible';
      }
      return s;
    });
  }

  function starsFromRank(index, total) {
    // 5★ pour le 1er, descend progressivement jusqu’à 3★ minimum pour les listés
    if (index === 0) return 5;
    if (index === 1 || index === 2) return 4;
    if (index <= 5) return 3;
    return 2;
  }

  function formatStars(n) {
    const full = Math.max(1, Math.min(5, n));
    return `${'★'.repeat(full)}${'☆'.repeat(5 - full)}`;
  }

  function formatPercent(rate) {
    if (rate == null || !Number.isFinite(rate)) return '—';
    return `${Math.round(rate * 100)} %`;
  }

  /** Suggestions de remplaçants — jamais d’affectation automatique. */
  function buildRemplacantSuggestions(teamKey = activeTeamKey()) {
    const team = getTeam(teamKey);
    const hourLabel = getState().hours?.[teamKey] || (teamKey === 'B' ? '22h' : '13h');
    const candidates = getActivePlayers()
      .filter((p) => !p.absent)
      .filter((p) => {
        const entry = ensureRosterEntry(team, p.id);
        return entry.availability === 'disponible';
      })
      .filter((p) => {
        const assignment = getStormAssignment(p.id);
        return !assignment.team; // non affecté A/B
      })
      .map((p) => {
        const stats = getPlayerRecStats(p.id);
        const presence = presenceRateForTeam(p.id, teamKey);
        const participantCount = teamKey === 'B' ? stats.participantB : stats.participantA;
        const remplacantCount = teamKey === 'B' ? stats.remplacantB : stats.remplacantA;
        const power = heroPower(p);
        const reasons = [
          'Disponible',
          'Non affecté',
          presence == null
            ? `Pas encore d’historique de présence à ${hourLabel}`
            : `${formatPercent(presence)} de présence à ${hourLabel}`,
        ];
        if (participantCount > 0) {
          reasons.push(
            participantCount >= 8
              ? `Déjà très présent dans l’équipe ${teamKey}`
              : `${participantCount} participation(s) Équipe ${teamKey}`
          );
        }
        if (remplacantCount > 0) {
          reasons.push(`${remplacantCount} fois remplaçant ${teamKey}`);
        }
        if (presence != null && presence >= 0.85) {
          reasons.push('Historique très fiable');
        } else if (presence != null && presence >= 0.7) {
          reasons.push('Bonne fiabilité historique');
        }
        return {
          id: p.id,
          pseudo: p.pseudo,
          presence,
          participantCount,
          remplacantCount,
          power,
          powerLabel: heroPowerLabel(p),
          hourLabel,
          teamKey,
          reasons,
        };
      })
      .sort((a, b) => {
        const pa = a.presence == null ? -1 : a.presence;
        const pb = b.presence == null ? -1 : b.presence;
        if (pb !== pa) return pb - pa;
        if (b.participantCount !== a.participantCount) return b.participantCount - a.participantCount;
        if (b.remplacantCount !== a.remplacantCount) return b.remplacantCount - a.remplacantCount;
        if (b.power !== a.power) return b.power - a.power;
        return a.pseudo.localeCompare(b.pseudo, 'fr', { sensitivity: 'base' });
      });

    return candidates.slice(0, 8).map((c, index) => ({
      ...c,
      stars: starsFromRank(index, candidates.length),
    }));
  }

  function renderSuggestions(list = null) {
    if (!els.suggestions) return;
    if (!list) {
      els.suggestions.classList.add('hidden');
      els.suggestions.innerHTML = '';
      return;
    }
    const teamKey = activeTeamKey();
    const hourLabel = getState().hours?.[teamKey] || (teamKey === 'B' ? '22h' : '13h');
    if (!list.length) {
      els.suggestions.classList.remove('hidden');
      els.suggestions.innerHTML = `
        <header class="block-header">
          <h3>Remplaçants conseillés</h3>
          <p>Équipe ${teamKey} · ${escapeHtml(hourLabel)} — aucun candidat éligible pour le moment</p>
        </header>
        <p class="panel-subtitle">Il faut un joueur disponible, non affecté, Actif et non marqué Absent.</p>
      `;
      return;
    }

    els.suggestions.classList.remove('hidden');
    els.suggestions.innerHTML = `
      <header class="block-header">
        <h3>Remplaçants conseillés</h3>
        <p>Équipe ${teamKey} · ${escapeHtml(hourLabel)} — propositions uniquement, aucune affectation automatique</p>
      </header>
      ${list
        .map((c) => {
          const presenceLine =
            c.presence == null
              ? 'Pas encore d’historique de présence'
              : `${formatPercent(c.presence)} de présence à ${escapeHtml(c.hourLabel)}`;
          return `
          <article class="tempete-suggestion-card">
            <p class="tempete-suggestion-title">
              <span class="tempete-stars">${formatStars(c.stars)}</span>
              ${escapeHtml(c.pseudo)}
            </p>
            <p class="tempete-suggestion-meta">${escapeHtml(presenceLine)}</p>
            <p class="tempete-suggestion-meta">${c.participantCount} participation(s) Équipe ${c.teamKey} · ${
              c.remplacantCount
            } fois remplaçant · ${escapeHtml(c.powerLabel)}</p>
            <p class="tempete-suggestion-meta"><strong>Pourquoi ${escapeHtml(c.pseudo)} ?</strong></p>
            <ul class="tempete-suggestion-why">
              ${c.reasons.map((r) => `<li>✓ ${escapeHtml(r)}</li>`).join('')}
            </ul>
          </article>
        `;
        })
        .join('')}
    `;
  }

  function onSuggestRemplacants() {
    const list = buildRemplacantSuggestions(activeTeamKey());
    renderSuggestions(list);
    if (list.length) {
      AppUI.toast(`${list.length} remplaçant(s) conseillé(s) — à valider manuellement.`);
    } else {
      AppUI.toast('Aucun remplaçant éligible à suggérer.');
    }
  }

  async function onResetAvailabilities() {
    const teamKey = activeTeamKey();
    const ok = await AppUI.confirm({
      title: 'Réinitialiser les disponibilités',
      message: `Passer tous les joueurs de l’équipe ${teamKey} en « Indisponible » ? Les sélections et la stratégie ne sont pas modifiées. Les archives restent inchangées.`,
      confirmLabel: 'Réinitialiser',
    });
    if (!ok) return;

    update((s) => {
      const team = s.teams[teamKey];
      getActivePlayers().forEach((p) => {
        const entry = ensureRosterEntry(team, p.id);
        entry.availability = 'indisponible';
      });
      Object.keys(team.roster).forEach((id) => {
        team.roster[id] = normalizeRosterEntry({
          ...team.roster[id],
          availability: 'indisponible',
        });
      });
      return s;
    });
    AppUI.toast('Disponibilités réinitialisées : Indisponible.');
  }

  async function onGenerateForTeam(teamKey) {
    const key = teamKey === 'B' ? 'B' : 'A';
    setActiveTeam(key);
    if (!isPlayersValidated(key)) {
      AppUI.toast(`Vérifiez et validez les joueurs de la Tempête ${key}.`);
      openVerifyPlayersModal(key);
      return;
    }
    const strategy = generateStrategy();
    if (!strategy) return;
    update((s) => {
      s.activeTeam = key;
      s.teams[key].strategy = strategy;
      s.teams[key].mail = '';
      return s;
    });
    AppUI.toast(`Stratégie générée — Tempête ${key}.`);
  }

  async function onGenerate() {
    return onGenerateForTeam(activeTeamKey());
  }

  function onGenerateMail() {
    const team = getTeam();
    if (!team.strategy) {
      AppUI.toast('Générez d’abord la stratégie.');
      return;
    }
    const controls = collectControlIssues(team);
    if (controls.blocking) {
      AppUI.toast('Mail bloqué : corrigez les doublons et les joueurs oubliés.');
      renderAnalysis();
      return;
    }
    const mail = buildMail(activeTeamKey());
    update((s) => {
      s.teams[s.activeTeam].mail = mail;
      return s;
    });
    AppUI.toast('Mail généré.');
  }

  async function onCopyMail() {
    const text = getTeam().mail || '';
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      const area = document.createElement('textarea');
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    els.mailFeedback?.classList.remove('hidden');
    AppUI.toast('Mail copié.');
  }

  async function onCloseStormForTeam(teamKey) {
    const key = teamKey === 'B' ? 'B' : 'A';
    setActiveTeam(key);
    const team = getTeam(key);
    const inscribed = [
      ...getSelectedPlayers(team, 'participant'),
      ...getSelectedPlayers(team, 'remplacant'),
    ];
    if (!inscribed.length) {
      AppUI.toast(`Aucun inscrit à clôturer pour la Tempête ${key}.`);
      return;
    }
    if (!team.strategy) {
      AppUI.toast(`Générez une stratégie pour la Tempête ${key} avant de clôturer.`);
      return;
    }

    const controls = collectControlIssues(team);
    if (controls.blocking) {
      AppUI.toast('Clôture bloquée : corrigez les doublons et les joueurs oubliés.');
      renderAnalysis();
      return;
    }

    openCloseStormModal(key);
  }

  async function onCloseStorm() {
    return onCloseStormForTeam(activeTeamKey());
  }

  function finalizeCloseStorm() {
    const teamKey = rosterModalTeam === 'B' ? 'B' : activeTeamKey();
    const current = getTeam(teamKey);
    const inscribed = [
      ...getSelectedPlayers(current, 'participant'),
      ...getSelectedPlayers(current, 'remplacant'),
    ];
    if (!inscribed.length || !current.strategy) {
      AppUI.toast('Clôture impossible.');
      return;
    }

    const controls = collectControlIssues(current);
    if (controls.blocking) {
      AppUI.toast('Clôture bloquée : corrigez les doublons et les joueurs oubliés.');
      closeRosterModal();
      renderAnalysis();
      return;
    }

    // Appliquer le brouillon de présences (défaut Présent)
    const attendance = {};
    inscribed.forEach((p) => {
      const status = closeAttendanceDraft[p.id];
      attendance[p.id] = Object.keys(ATTEND).includes(status) ? status : 'present';
    });

    const s = getState();
    const participants = getSelectedPlayers(current, 'participant');
    const remplacants = getSelectedPlayers(current, 'remplacant');

    const playerOutcomes = {};
    const inscribedIds = new Set([...participants, ...remplacants].map((p) => p.id));
    getActivePlayers().forEach((p) => {
      if (inscribedIds.has(p.id)) {
        const role =
          ensureRosterEntry(current, p.id).selection === 'remplacant' ? 'remplacant' : 'participant';
        playerOutcomes[p.id] = {
          role,
          attendance: attendance[p.id] || null,
          team: teamKey,
        };
      } else {
        playerOutcomes[p.id] = {
          role: 'non_inscrit',
          attendance: null,
          team: teamKey,
        };
      }
    });

    const actor =
      global.ROSProfiles && typeof ROSProfiles.stampActor === 'function'
        ? ROSProfiles.stampActor()
        : { actorUserId: '', actorPlayerId: null, actorLabel: '' };

    const archive = {
      id: uid('storm'),
      team: teamKey,
      hour: s.hours[teamKey],
      closedAt: new Date().toISOString(),
      closedByUserId: actor.actorUserId || '',
      closedByPlayerId: actor.actorPlayerId || null,
      closedBy: actor.actorLabel || '',
      participants: participants.map((p) => ({
        id: p.id,
        pseudo: p.pseudo,
      })),
      remplacants: remplacants.map((p) => ({
        id: p.id,
        pseudo: p.pseudo,
      })),
      volants: (current.strategy.volantIds || []).map((id, i) => ({
        id,
        pseudo: getPlayerById(id)?.pseudo || id,
        index: i + 1,
      })),
      strategy: current.strategy,
      mail: current.mail || buildMail(teamKey),
      attendance: { ...attendance },
      hours: { ...s.hours },
      playerOutcomes,
    };

    // Stats joueurs : uniquement les inscrits de CETTE Tempête
    ROSStorage.update((alliance) => {
      inscribed.forEach((p) => {
        const player = alliance.players.find((x) => x.id === p.id);
        if (!player) return;
        const status = attendance[p.id];
        if (status === 'absent') {
          player.stormAbsencesUnexcused = Math.max(0, Number(player.stormAbsencesUnexcused) || 0) + 1;
        } else if (status === 'absent_excuse') {
          player.stormAbsencesExcused = Math.max(0, Number(player.stormAbsencesExcused) || 0) + 1;
        }
      });
      return alliance;
    });

    closeRosterModal();

    update((st) => {
      st.archives.unshift(archive);
      st.recommendationStats = rebuildRecommendationStats(st.archives);
      st.teams[teamKey] = createBlankTeam();
      seedMissingRosterAsUnavailable(st.teams[teamKey]);
      clearTeamValidation(st, teamKey);
      // L’autre Tempête (roster, stratégie, validation) reste intacte
      return st;
    });
    renderSuggestions(null);
    AppUI.toast(`Tempête ${teamKey} clôturée — l’autre Tempête n’a pas été modifiée.`);
  }

  function resolveArchivedPlayerName(entry) {
    if (!entry) return '—';
    const id = entry.id || entry;
    const fallback = entry.pseudo || '—';
    return ROSModels.getPlayerDisplayName(ROSStorage.getState(), id, fallback);
  }

  function showArchive(id) {
    const arch = getState().archives.find((a) => a.id === id);
    if (!arch) return;
    const mail = arch.mail || '—';
    const participantNames = (arch.participants || [])
      .map((p) => resolveArchivedPlayerName(p))
      .join(', ');
    AppUI.confirm({
      title: `Archive Équipe ${arch.team}`,
      message: `${arch.hour || ''} · ${arch.participants?.length || 0} participants${
        participantNames ? `\n${participantNames}` : ''
      }\n\nMail archivé (aperçu) :\n${mail.slice(0, 400)}${mail.length > 400 ? '…' : ''}`,
      confirmLabel: 'Fermer',
    });
  }

  function migratePlayerIdentity(players, options = {}) {
    const s = getState();
    const result = ROSPlayerIdentity
      ? ROSPlayerIdentity.migrateTempeteState(s, players || ROSStorage.getState().players, options)
      : { changed: false };
    if (result.changed) persist();
    return result.changed;
  }

  function onRootChange(event) {
    const avail = event.target.closest('[data-tempete-field]');
    if (avail) {
      setRosterField(avail.dataset.player, avail.dataset.tempeteField, avail.value);
      return;
    }
    const add = event.target.closest('[data-tempete-add-row]');
    if (add && add.value) {
      addPlayerToRow(add.dataset.tempeteAddRow, add.value);
      return;
    }
    const replace = event.target.closest('[data-tempete-replace-row]');
    if (replace && replace.value) {
      replacePlayerInRow(
        replace.dataset.tempeteReplaceRow,
        replace.dataset.tempeteReplaceOld,
        replace.value
      );
      return;
    }
    const closeStatus = event.target.closest('[data-tempete-close-status]');
    if (closeStatus) {
      const playerId = closeStatus.dataset.tempeteCloseStatus;
      const value = closeStatus.value;
      closeAttendanceDraft[playerId] = Object.keys(ATTEND).includes(value) ? value : 'present';
    }
  }

  function onRootClick(event) {
    const actionBtn = event.target.closest('[data-tempete-action]');
    if (actionBtn) {
      const team = actionBtn.dataset.team === 'B' ? 'B' : 'A';
      const action = actionBtn.dataset.tempeteAction;
      if (action === 'verify') openVerifyPlayersModal(team);
      else if (action === 'generate') onGenerateForTeam(team);
      else if (action === 'close') onCloseStormForTeam(team);
      return;
    }
    const card = event.target.closest('[data-tempete-card]');
    if (card && !event.target.closest('button')) {
      setActiveTeam(card.dataset.tempeteCard === 'B' ? 'B' : 'A');
      return;
    }
    const remove = event.target.closest('[data-tempete-remove-row]');
    if (remove) {
      removePlayerFromRow(remove.dataset.tempeteRemoveRow, remove.dataset.tempeteRemovePlayer);
      return;
    }
    const btn = event.target.closest('[data-tempete-archive]');
    if (btn) showArchive(btn.dataset.tempeteArchive);
  }

  function onSelectionClick(event) {
    const detail = event.target.closest('[data-tempete-presence-detail]');
    if (detail) {
      openPresenceDetail(detail.dataset.tempetePresenceDetail);
      return;
    }
    const filterBtn = event.target.closest('[data-tempete-presence-filter]');
    if (filterBtn) {
      presenceFilter = filterBtn.dataset.tempetePresenceFilter || 'all';
      renderSelectionModal();
    }
  }

  function init() {
    cacheDom();
    loadState();

    // Nouvelle Tempête (roster vide) : prépare les joueurs en Indisponible — sans toucher aux archives
    const s0 = getState();
    seedMissingRosterAsUnavailable(s0.teams.A);
    seedMissingRosterAsUnavailable(s0.teams.B);
    persist();

    els.activeTeam?.addEventListener('change', () => {
      update((s) => {
        s.activeTeam = els.activeTeam.value === 'B' ? 'B' : 'A';
        return s;
      });
      renderSuggestions(null);
    });
    els.hourA?.addEventListener('change', () => {
      update((s) => {
        s.hours.A = els.hourA.value.trim() || '13h';
        return s;
      });
    });
    els.hourB?.addEventListener('change', () => {
      update((s) => {
        s.hours.B = els.hourB.value.trim() || '22h';
        return s;
      });
    });

    els.btnOpenSelection?.addEventListener('click', openSelectionModal);
    els.btnResetAvailability?.addEventListener('click', onResetAvailabilities);
    els.btnSuggestRemplacants?.addEventListener('click', onSuggestRemplacants);
    els.btnGenerateMail?.addEventListener('click', onGenerateMail);
    els.btnCopyMail?.addEventListener('click', onCopyMail);

    els.root?.addEventListener('change', onRootChange);
    els.root?.addEventListener('click', onRootClick);
    els.selectionModal?.addEventListener('click', onSelectionClick);
    els.rosterModal?.addEventListener('change', onRootChange);
    els.rosterModalCancel?.addEventListener('click', closeRosterModal);
    els.rosterModalX?.addEventListener('click', closeRosterModal);
    els.rosterModalConfirm?.addEventListener('click', () => {
      if (rosterModalMode === 'verify') onValidatePlayers();
      else if (rosterModalMode === 'close') finalizeCloseStorm();
    });
    document.getElementById('tempeteSelectionClose')?.addEventListener('click', closeSelectionModal);
    document.getElementById('tempeteSelectionCloseBtn')?.addEventListener('click', closeSelectionModal);
    document.getElementById('tempetePresenceClose')?.addEventListener('click', closePresenceModal);
    document.getElementById('tempetePresenceCloseBtn')?.addEventListener('click', closePresenceModal);

    render();
  }

  /** API future pour le Poste de Commandement */
  function getRecentAbsenceAlerts() {
    return getActivePlayers()
      .filter((p) => (Number(p.stormAbsencesUnexcused) || 0) > 0)
      .map((p) => ({
        playerId: p.id,
        pseudo: p.pseudo,
        unexcused: Number(p.stormAbsencesUnexcused) || 0,
        excused: Number(p.stormAbsencesExcused) || 0,
      }));
  }

  global.TempeteModule = {
    init,
    render,
    STORAGE_KEY,
    getRecentAbsenceAlerts,
    migratePlayerIdentity,
    getPlayerPresenceHistory,
  };
})(window);
