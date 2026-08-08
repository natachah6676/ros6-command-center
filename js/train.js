/**
 * Module Train — indépendant (stockage dédié)
 * Prépare le planning Conducteurs / VIP ROS6.
 */
(function (global) {
  const STORAGE_KEY = 'ros6_train_v1';
  const DAYS = [
    { key: 'lundi', label: 'Lundi' },
    { key: 'mardi', label: 'Mardi' },
    { key: 'mercredi', label: 'Mercredi' },
    { key: 'jeudi', label: 'Jeudi' },
    { key: 'vendredi', label: 'Vendredi' },
  ];

  const WEEK_DAYS = [
    { key: 'lundi', label: 'Lundi' },
    { key: 'mardi', label: 'Mardi' },
    { key: 'mercredi', label: 'Mercredi' },
    { key: 'jeudi', label: 'Jeudi' },
    { key: 'vendredi', label: 'Vendredi' },
    { key: 'samedi', label: 'Samedi' },
    { key: 'dimanche', label: 'Dimanche' },
  ];

  const ASSIGNABLE_DAYS = WEEK_DAYS.filter((d) => d.key !== 'dimanche');

  const DEFAULT_CATEGORY_NAMES = [
    'MVP',
    "Champion de l'Alliance",
    "MVP Exercice d'Alliance",
    'Étoile Brillante',
    'Roi du Train-train',
    'Entraîneur du Diable',
    'Grand Destructeur',
    'Bon Assistant',
  ];

  /** Compteurs initiaux du mois en cours (par pseudo). */
  const SEED_CONDUCTORS = {
    'SuperSonic Sparrow': 1,
    HGS123: 1,
    XalAtath: 1,
    'Ofée Lee Rose': 1,
    Stefko000: 1,
    'Mertz 1': 1,
  };

  const SEED_VIPS = {
    FafaneLeBarbu: 1,
    Diidine89: 1,
    seigneur777: 1,
    aria0502: 1,
    orely: 1,
  };

  const els = {};
  let state = null;
  let skipPersist = false;
  /** Tirage VIP : { dayKey, playerId } ou null */
  let vipDrawProposal = null;
  /** Remplacement manuel : { dayKey, field: 'conductorId'|'vipId' } */
  let replaceContext = null;

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

  function makeCategory(name, type = 'saison') {
    return {
      id: uid('cat'),
      name,
      type,
      day: null,
      firstId: null,
      secondId: null,
      vipId: null,
      vipMode: null,
    };
  }

  function defaultCategories() {
    return DEFAULT_CATEGORY_NAMES.map((name) => makeCategory(name, 'saison'));
  }

  /** Anciennes catégories jour (Lun–Ven) vides → migrer vers le pack ROS6. */
  function isLegacyEmptyDayCategories(categories) {
    if (!Array.isArray(categories) || categories.length !== 5) return false;
    const dayKeys = new Set(DAYS.map((d) => d.key));
    return categories.every(
      (c) =>
        c.type === 'hors_saison' &&
        dayKeys.has(c.day) &&
        !c.firstId &&
        !c.secondId &&
        !c.vipId
    );
  }

  function emptyWeekDays() {
    const days = {};
    WEEK_DAYS.forEach((d) => {
      days[d.key] = { conductorId: null, vipId: null, vipMode: null };
    });
    return days;
  }

  function createBlankWeeklyPlan(weekId = null, vsWeekId = null) {
    const resolvedVs = vsWeekId != null ? vsWeekId : weekId;
    return {
      weekId,
      vsWeekId: resolvedVs,
      days: emptyWeekDays(),
    };
  }

  function createBlankState() {
    return {
      version: 2,
      categories: defaultCategories(),
      history: [],
      monthlyCounts: {},
      appliedPlans: {},
      weekArchives: [],
      seedAppliedMonths: [],
      weeklyPlan: createBlankWeeklyPlan(),
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        state = createBlankState();
        ensureMonthSeed(state, currentMonthKey());
        syncWeeklyPlanToCurrentWeek(state);
        persist();
        return state;
      }
      const parsed = JSON.parse(raw);
      let categories = Array.isArray(parsed.categories) ? parsed.categories : defaultCategories();
      if (isLegacyEmptyDayCategories(categories)) {
        categories = defaultCategories();
      }
      state = {
        version: 2,
        categories,
        history: Array.isArray(parsed.history) ? parsed.history : [],
        monthlyCounts:
          parsed.monthlyCounts && typeof parsed.monthlyCounts === 'object' ? parsed.monthlyCounts : {},
        appliedPlans:
          parsed.appliedPlans && typeof parsed.appliedPlans === 'object' ? parsed.appliedPlans : {},
        weekArchives: Array.isArray(parsed.weekArchives) ? parsed.weekArchives : [],
        seedAppliedMonths: Array.isArray(parsed.seedAppliedMonths) ? parsed.seedAppliedMonths : [],
        weeklyPlan:
          parsed.weeklyPlan && typeof parsed.weeklyPlan === 'object'
            ? normalizeWeeklyPlan(parsed.weeklyPlan)
            : createBlankWeeklyPlan(),
      };
      if (global.ROSPlayerIdentity && global.ROSStorage) {
        ROSPlayerIdentity.migrateTrainState(state, ROSStorage.getState().players);
      }
      ensureMonthSeed(state, currentMonthKey());
      syncWeeklyPlanToCurrentWeek(state);
      persist();
      return state;
    } catch (error) {
      console.error('Train: chargement impossible', error);
      state = createBlankState();
      ensureMonthSeed(state, currentMonthKey());
      return state;
    }
  }

  function persist() {
    if (skipPersist) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if (global.ROSSync && typeof ROSSync.schedulePush === 'function') {
      ROSSync.schedulePush();
    }
  }

  /** Recharge depuis localStorage sans renvoyer vers Supabase. */
  function hydrateFromStorage() {
    skipPersist = true;
    try {
      loadState();
    } finally {
      skipPersist = false;
    }
    return state;
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

  /* ---------- Lecture croisée (sans modifier les autres modules) ---------- */

  function getAllianceState() {
    return ROSStorage.getState();
  }

  function getActivePlayers() {
    return getAllianceState()
      .players.filter((p) => p.status === 'Actif')
      .sort((a, b) => a.pseudo.localeCompare(b.pseudo, 'fr', { sensitivity: 'base' }));
  }

  function getPlayerById(id) {
    if (!id) return null;
    return getAllianceState().players.find((p) => p.id === id) || null;
  }

  function getCurrentWeek() {
    const alliance = getAllianceState();
    return ROSModels.getCurrentWeekFromState(alliance);
  }

  function getPlayerWeekColor(playerId) {
    const week = getCurrentWeek();
    const summary = ROSModels.getWeekScoreSummary(week, playerId);
    return summary.color;
  }

  function currentMonthKey(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  function historyMonthKey(entry) {
    if (entry.monthKey) return entry.monthKey;
    if (!entry.createdAt) return '';
    const d = new Date(entry.createdAt);
    return currentMonthKey(d);
  }

  function ensureMonthBucket(trainState, monthKey) {
    if (!trainState.monthlyCounts) trainState.monthlyCounts = {};
    if (!trainState.monthlyCounts[monthKey]) {
      trainState.monthlyCounts[monthKey] = {};
    }
    return trainState.monthlyCounts[monthKey];
  }

  function findPlayerIdByPseudo(pseudo) {
    const target = String(pseudo || '').trim().toLowerCase();
    const player = getAllianceState().players.find(
      (p) => p.pseudo.trim().toLowerCase() === target
    );
    return player ? player.id : null;
  }

  function ensureMonthSeed(trainState, monthKey) {
    if (!trainState.seedAppliedMonths) trainState.seedAppliedMonths = [];
    ensureMonthBucket(trainState, monthKey);
    if (trainState.seedAppliedMonths.includes(monthKey)) return;

    Object.entries(SEED_CONDUCTORS).forEach(([pseudo, value]) => {
      const id = findPlayerIdByPseudo(pseudo);
      if (!id) return;
      const row = trainState.monthlyCounts[monthKey][id] || { conductor: 0, vip: 0 };
      row.conductor = Math.max(row.conductor || 0, Number(value) || 0);
      trainState.monthlyCounts[monthKey][id] = row;
    });

    Object.entries(SEED_VIPS).forEach(([pseudo, value]) => {
      const id = findPlayerIdByPseudo(pseudo);
      if (!id) return;
      const row = trainState.monthlyCounts[monthKey][id] || { conductor: 0, vip: 0 };
      row.vip = Math.max(row.vip || 0, Number(value) || 0);
      trainState.monthlyCounts[monthKey][id] = row;
    });

    trainState.seedAppliedMonths.push(monthKey);
  }

  function readCountsFrom(trainState, monthKey, playerId) {
    if (!playerId) return { conductor: 0, vip: 0 };
    const row = (trainState.monthlyCounts[monthKey] || {})[playerId];
    return {
      conductor: Number(row?.conductor) || 0,
      vip: Number(row?.vip) || 0,
    };
  }

  function getPlayerMonthCounts(playerId, monthKey = currentMonthKey()) {
    return readCountsFrom(getState(), monthKey, playerId);
  }

  function formatPlayerCounters(player, monthKey = currentMonthKey()) {
    if (!player) return '';
    const counts = getPlayerMonthCounts(player.id, monthKey);
    return `${player.pseudo} — Conducteur ${counts.conductor} | VIP ${counts.vip}`;
  }

  function formatCountersShort(playerId, monthKey = currentMonthKey()) {
    const counts = getPlayerMonthCounts(playerId, monthKey);
    return `Conducteur ${counts.conductor} | VIP ${counts.vip}`;
  }

  function adjustCount(trainState, monthKey, playerId, field, delta) {
    if (!playerId || !delta) return;
    const bucket = ensureMonthBucket(trainState, monthKey);
    const row = bucket[playerId] || { conductor: 0, vip: 0 };
    row[field] = Math.max(0, (Number(row[field]) || 0) + delta);
    bucket[playerId] = row;
  }

  function buildPlanKey(categories) {
    return categories
      .map((c) => `${c.id}:${c.firstId || ''}:${c.secondId || ''}:${c.vipId || ''}:${c.vipMode || ''}`)
      .sort()
      .join('|');
  }

  function buildPlanDeltas(categories) {
    const conductorIds = new Set();
    const vipIds = new Set();
    categories.forEach((cat) => {
      if (cat.firstId) conductorIds.add(cat.firstId);
      if (cat.vipId) vipIds.add(cat.vipId);
    });
    const deltas = [];
    conductorIds.forEach((id) => deltas.push({ playerId: id, conductor: 1, vip: 0 }));
    vipIds.forEach((id) => {
      const existing = deltas.find((d) => d.playerId === id);
      if (existing) existing.vip += 1;
      else deltas.push({ playerId: id, conductor: 0, vip: 1 });
    });
    return deltas;
  }

  function buildWeeklyPlanKey(plan) {
    return WEEK_DAYS.map((d) => {
      const slot = plan.days[d.key] || {};
      return `${d.key}:${slot.conductorId || ''}:${slot.vipId || ''}:${slot.vipMode || ''}`;
    }).join('|');
  }

  function buildWeeklyPlanDeltas(plan) {
    const conductorIds = new Set();
    const vipIds = new Set();
    WEEK_DAYS.forEach((d) => {
      const slot = plan.days[d.key] || {};
      if (slot.conductorId) conductorIds.add(slot.conductorId);
      if (slot.vipId) vipIds.add(slot.vipId);
    });
    const deltas = [];
    conductorIds.forEach((id) => deltas.push({ playerId: id, conductor: 1, vip: 0 }));
    vipIds.forEach((id) => {
      const existing = deltas.find((d) => d.playerId === id);
      if (existing) existing.vip += 1;
      else deltas.push({ playerId: id, conductor: 0, vip: 1 });
    });
    return deltas;
  }

  function isSundayFilled(plan = getWeeklyPlan()) {
    const sunday = plan.days.dimanche || {};
    return Boolean(sunday.conductorId && sunday.vipId);
  }

  function areWeekdaysComplete(plan = getWeeklyPlan()) {
    return ASSIGNABLE_DAYS.every((d) => {
      const slot = plan.days[d.key] || {};
      return Boolean(slot.conductorId && slot.vipId);
    });
  }

  function getAppRole() {
    if (global.ROSProfiles && typeof ROSProfiles.getAppRole === 'function') {
      return ROSProfiles.getAppRole();
    }
    return getAllianceState().appRole || 'R5';
  }

  function stampActor() {
    if (global.ROSProfiles && typeof ROSProfiles.stampActor === 'function') {
      return ROSProfiles.stampActor();
    }
    return { actorUserId: '', actorPlayerId: null, actorLabel: '' };
  }

  function isR5() {
    return getAppRole() === 'R5';
  }

  function getAppliedWeek(weekId) {
    if (!weekId) return null;
    return getState().appliedPlans?.[weekId] || null;
  }

  function isCurrentWeekLocked() {
    const plan = getWeeklyPlan();
    const applied = getAppliedWeek(plan.weekId);
    return Boolean(applied?.locked);
  }

  function findCategoryForPlayer(playerId) {
    if (!playerId) return null;
    return (
      getState().categories.find((c) => c.firstId === playerId) ||
      getState().categories.find((c) => c.secondId === playerId) ||
      null
    );
  }

  function applyDeltas(trainState, monthKey, deltas, direction) {
    const sign = direction === 'reverse' ? -1 : 1;
    deltas.forEach((d) => {
      if (d.conductor) adjustCount(trainState, monthKey, d.playerId, 'conductor', sign * d.conductor);
      if (d.vip) adjustCount(trainState, monthKey, d.playerId, 'vip', sign * d.vip);
    });
  }

  function getVipIdsThisMonth() {
    const month = currentMonthKey();
    const bucket = getState().monthlyCounts[month] || {};
    return new Set(
      Object.entries(bucket)
        .filter(([, row]) => (Number(row.vip) || 0) > 0)
        .map(([playerId]) => playerId)
    );
  }

  function normalizeWeeklyPlan(raw) {
    const weekId = raw.weekId || null;
    const vsWeekId = raw.vsWeekId != null ? raw.vsWeekId : weekId;
    const plan = createBlankWeeklyPlan(weekId, vsWeekId);
    WEEK_DAYS.forEach((d) => {
      const src = raw.days && raw.days[d.key] ? raw.days[d.key] : {};
      plan.days[d.key] = {
        conductorId: src.conductorId || null,
        vipId: src.vipId || null,
        vipMode: src.vipMode || null,
      };
    });
    return plan;
  }

  function syncWeeklyPlanToCurrentWeek(trainState) {
    const week = getCurrentWeek();
    const vsWeekId = week ? week.id : null;
    if (!trainState.weeklyPlan) {
      trainState.weeklyPlan = createBlankWeeklyPlan(vsWeekId, vsWeekId);
      return;
    }
    trainState.weeklyPlan = normalizeWeeklyPlan(trainState.weeklyPlan);
    if (trainState.weeklyPlan.vsWeekId == null) {
      trainState.weeklyPlan.vsWeekId = trainState.weeklyPlan.weekId;
    }
    // Nouvelle semaine VS : repartir d’un planning vide (archives / historique intacts)
    if (trainState.weeklyPlan.vsWeekId !== vsWeekId) {
      trainState.weeklyPlan = createBlankWeeklyPlan(vsWeekId, vsWeekId);
    }
  }

  function getWeeklyPlan() {
    const trainState = getState();
    syncWeeklyPlanToCurrentWeek(trainState);
    return trainState.weeklyPlan;
  }

  function getConductorIds() {
    const ids = new Set();
    getState().categories.forEach((cat) => {
      if (cat.firstId) ids.add(cat.firstId);
      if (cat.secondId) ids.add(cat.secondId);
    });
    return ids;
  }

  function getWeekConductorIds() {
    const plan = getWeeklyPlan();
    const ids = new Set();
    WEEK_DAYS.forEach((d) => {
      const id = plan.days[d.key]?.conductorId;
      if (id) ids.add(id);
    });
    return ids;
  }

  /** Conducteurs réellement affectés Lun→Sam uniquement (IDs non vides). */
  function getWeekdayConductorAssignments() {
    const plan = getWeeklyPlan();
    const byPlayer = new Map();
    ASSIGNABLE_DAYS.forEach((d) => {
      const id = plan.days[d.key]?.conductorId;
      if (!id) return;
      if (!byPlayer.has(id)) byPlayer.set(id, []);
      byPlayer.get(id).push(d.key);
    });
    return byPlayer;
  }

  function findWeekdayConductorDuplicates() {
    const byPlayer = getWeekdayConductorAssignments();
    const duplicates = [];
    byPlayer.forEach((dayKeys, playerId) => {
      const distinctDays = [...new Set(dayKeys.filter(Boolean))];
      const player = getPlayerById(playerId);
      console.log('[Train diagnostic doublon conducteur]', {
        joueur: player ? player.pseudo : playerId,
        playerId,
        jours: distinctDays.map((k) => WEEK_DAYS.find((d) => d.key === k)?.label || k),
      });
      if (distinctDays.length >= 2) {
        duplicates.push({ playerId, days: distinctDays, player });
      }
    });
    return duplicates;
  }

  function getWeekVipIds(exceptDayKey) {
    const plan = getWeeklyPlan();
    const ids = new Set();
    WEEK_DAYS.forEach((d) => {
      if (exceptDayKey && d.key === exceptDayKey) return;
      const id = plan.days[d.key]?.vipId;
      if (id) ids.add(id);
    });
    return ids;
  }

  function getFirstCandidates() {
    return getState()
      .categories.filter((c) => c.firstId)
      .map((c) => ({
        categoryId: c.id,
        categoryName: c.name,
        player: getPlayerById(c.firstId),
        playerId: c.firstId,
      }))
      .filter((c) => c.player);
  }

  function isEligibleForWeekVip(player, exceptDayKey) {
    if (!player || player.status !== 'Actif') return false;
    if (player.absent) return false;
    const color = getPlayerWeekColor(player.id);
    // Hors Vert (Rouge et Orange) exclus du tirage VIP
    if (color === 'color-orange' || color === 'color-red') return false;
    // Conducteurs déjà choisis cette semaine (y compris le jour cible) — jamais VIP
    if (getWeekConductorIds().has(player.id)) return false;
    // VIP déjà VIP ce mois
    if (getVipIdsThisMonth().has(player.id)) return false;
    // VIP déjà pris un autre jour de la semaine
    if (getWeekVipIds(exceptDayKey).has(player.id)) return false;
    // Conducteur du jour cible (sécurité explicite)
    const dayConductor = getWeeklyPlan().days[exceptDayKey]?.conductorId;
    if (dayConductor && dayConductor === player.id) return false;
    return true;
  }

  function getEligibleWeekVipPlayers(exceptDayKey) {
    return getActivePlayers().filter((p) => isEligibleForWeekVip(p, exceptDayKey));
  }

  /** Conducteur manuel / affectation : Actif, présent, Vert, pas déjà conducteur Lun–Sam. */
  function isEligibleForWeekConductor(player, exceptDayKey) {
    if (!player || player.status !== 'Actif') return false;
    if (player.absent) return false;
    const color = getPlayerWeekColor(player.id);
    if (color === 'color-orange' || color === 'color-red') return false;
    const plan = getWeeklyPlan();
    const conflict = ASSIGNABLE_DAYS.some(
      (d) =>
        d.key !== exceptDayKey &&
        plan.days[d.key]?.conductorId &&
        plan.days[d.key].conductorId === player.id
    );
    if (conflict) return false;
    return true;
  }

  function getEligibleWeekConductorPlayers(exceptDayKey) {
    return getActivePlayers().filter((p) => isEligibleForWeekConductor(p, exceptDayKey));
  }

  /**
   * Transparence du tirage VIP — décomptes (un joueur peut apparaître dans plusieurs lignes).
   * totalExcluded = joueurs Actifs non éligibles au tirage du jour.
   */
  function getVipDrawExclusionStats(dayKey) {
    const key = dayKey || els.vipDrawDay?.value || 'lundi';
    const actifs = getActivePlayers();
    let absents = 0;
    let rouges = 0;
    let conductors = 0;
    let vipMonth = 0;
    let totalExcluded = 0;
    const weekConductors = getWeekConductorIds();
    const vipMonthIds = getVipIdsThisMonth();

    actifs.forEach((p) => {
      if (isEligibleForWeekVip(p, key)) return;
      totalExcluded += 1;
      if (p.absent) absents += 1;
      const color = getPlayerWeekColor(p.id);
      if (!p.absent && (color === 'color-red' || color === 'color-orange')) rouges += 1;
      if (weekConductors.has(p.id)) conductors += 1;
      if (vipMonthIds.has(p.id)) vipMonth += 1;
    });

    return {
      dayKey: key,
      totalExcluded,
      absents,
      rouges,
      conductors,
      vipMonth,
      eligible: Math.max(0, actifs.length - totalExcluded),
    };
  }

  function pickRandomEligibleVip(dayKey) {
    const eligible = getEligibleWeekVipPlayers(dayKey);
    if (!eligible.length) return null;
    const index = Math.floor(Math.random() * eligible.length);
    return eligible[index];
  }

  function runVipDraw(dayKey) {
    if (isCurrentWeekLocked()) {
      AppUI.toast('Semaine clôturée — déverrouillage R5 requis.');
      return;
    }
    const key = dayKey || els.vipDrawDay?.value || 'lundi';
    const player = pickRandomEligibleVip(key);
    if (!player) {
      vipDrawProposal = null;
      AppUI.toast('Aucun joueur éligible pour le tirage VIP.');
      renderVipDrawPanel();
      return;
    }
    vipDrawProposal = { dayKey: key, playerId: player.id };
    renderVipDrawPanel();
    AppUI.toast(`Tirage : ${player.pseudo}`);
  }

  function validateVipDraw() {
    if (!vipDrawProposal?.playerId || !vipDrawProposal?.dayKey) {
      AppUI.toast('Aucun joueur tiré à valider.');
      return;
    }
    if (isCurrentWeekLocked()) {
      AppUI.toast('Semaine clôturée — déverrouillage R5 requis.');
      return;
    }
    const { dayKey, playerId } = vipDrawProposal;
    const player = getPlayerById(playerId);
    if (!player || !isEligibleForWeekVip(player, dayKey)) {
      AppUI.toast('Ce joueur n’est plus éligible — relancez le tirage.');
      vipDrawProposal = null;
      renderVipDrawPanel();
      return;
    }
    update((s) => {
      syncWeeklyPlanToCurrentWeek(s);
      if (!s.weeklyPlan.days[dayKey]) {
        s.weeklyPlan.days[dayKey] = { conductorId: null, vipId: null, vipMode: null };
      }
      s.weeklyPlan.days[dayKey].vipId = playerId;
      s.weeklyPlan.days[dayKey].vipMode = 'tirage';
      return s;
    });
    const dayLabel = WEEK_DAYS.find((d) => d.key === dayKey)?.label || dayKey;
    AppUI.toast(`VIP validé pour ${dayLabel} : ${player.pseudo}`);
    vipDrawProposal = null;
    renderVipDrawPanel();
  }

  function renderVipDrawDaySelect() {
    if (!els.vipDrawDay) return;
    const current = els.vipDrawDay.value || vipDrawProposal?.dayKey || 'lundi';
    els.vipDrawDay.innerHTML = WEEK_DAYS.map(
      (d) =>
        `<option value="${d.key}" ${d.key === current ? 'selected' : ''}>${d.label}</option>`
    ).join('');
  }

  function renderVipDrawPanel() {
    if (!els.vipDrawPanel) return;
    const locked = isCurrentWeekLocked();
    if (locked) {
      els.vipDrawPanel.innerHTML =
        '<p class="panel-subtitle">Semaine clôturée — tirage indisponible.</p>';
      if (els.btnVipDraw) els.btnVipDraw.disabled = true;
      return;
    }
    if (els.btnVipDraw) els.btnVipDraw.disabled = false;

    if (!vipDrawProposal?.playerId) {
      els.vipDrawPanel.innerHTML =
        '<p class="panel-subtitle">Lancez un tirage pour proposer un VIP éligible.</p>';
      return;
    }

    const player = getPlayerById(vipDrawProposal.playerId);
    const dayLabel =
      WEEK_DAYS.find((d) => d.key === vipDrawProposal.dayKey)?.label || vipDrawProposal.dayKey;
    if (!player) {
      els.vipDrawPanel.innerHTML = '<p class="empty-state">Joueur introuvable — relancez le tirage.</p>';
      return;
    }

    els.vipDrawPanel.innerHTML = `
      <article class="stack-item">
        <div class="stack-item-main">
          <h4 class="stack-item-title">${escapeHtml(player.pseudo)}</h4>
          <p class="panel-subtitle">
            Proposé pour ${escapeHtml(dayLabel)} · ${escapeHtml(formatCountersShort(player.id))}
          </p>
        </div>
        <div class="settings-actions">
          <button type="button" class="btn btn-ghost btn-sm" data-train-action="vip-redraw">Relancer le tirage</button>
          <button type="button" class="btn btn-primary btn-sm" data-train-action="vip-validate-draw">Valider ce joueur</button>
        </div>
      </article>
    `;
  }

  function getVipIdsSelected(exceptCategoryId) {
    return new Set(
      getState()
        .categories.filter((c) => c.id !== exceptCategoryId && c.vipId)
        .map((c) => c.vipId)
    );
  }

  function isEligibleForVip(player, options = {}) {
    if (!player || player.status !== 'Actif') return false;
    if (player.absent) return false;
    const color = getPlayerWeekColor(player.id);
    if (color === 'color-orange' || color === 'color-red') return false;
    if (getConductorIds().has(player.id)) return false;
    if (getVipIdsThisMonth().has(player.id)) return false;
    if (getVipIdsSelected(options.exceptCategoryId).has(player.id)) return false;
    return true;
  }

  function getEligibleVipPlayers(options = {}) {
    return getActivePlayers().filter((p) => isEligibleForVip(p, options));
  }

  /* ---------- Catégories ---------- */

  function allFirstFilled() {
    const cats = getState().categories;
    return cats.length > 0 && cats.every((c) => Boolean(c.firstId));
  }

  function findFirstConflicts() {
    const map = new Map();
    getState().categories.forEach((cat) => {
      if (!cat.firstId) return;
      if (!map.has(cat.firstId)) map.set(cat.firstId, []);
      map.get(cat.firstId).push(cat);
    });
    return Array.from(map.entries())
      .filter(([, cats]) => cats.length > 1)
      .map(([playerId, cats]) => ({
        player: getPlayerById(playerId),
        playerId,
        categories: cats,
      }));
  }

  /* ---------- Validation planning ---------- */

  function pushPlayerEligibilityErrors(errors, playerId, contextLabel) {
    const p = getPlayerById(playerId);
    if (!p) {
      errors.push(`Joueur introuvable (${contextLabel})`);
      return;
    }
    if (p.absent) errors.push(`Joueur absent : ${p.pseudo} (${contextLabel})`);
    const color = getPlayerWeekColor(playerId);
    if (color === 'color-orange') errors.push(`Joueur orange : ${p.pseudo} (${contextLabel})`);
    if (color === 'color-red') errors.push(`Joueur rouge : ${p.pseudo} (${contextLabel})`);
  }

  /** Erreurs doublons / éligibilité du planning hebdo (dimanche vide autorisé). */
  function validateWeeklyPlanErrors() {
    const errors = [];
    const plan = getWeeklyPlan();
    const weekConductors = new Set();
    const weekVips = new Map();

    findWeekdayConductorDuplicates().forEach(({ player, playerId, days }) => {
      const dayLabels = days
        .map((k) => WEEK_DAYS.find((d) => d.key === k)?.label || k)
        .join(', ');
      errors.push(
        `Conducteur en double dans le planning : ${player ? player.pseudo : playerId} (${dayLabels})`
      );
    });

    WEEK_DAYS.forEach((d) => {
      const slot = plan.days[d.key] || {};
      if (slot.conductorId) weekConductors.add(slot.conductorId);
      if (slot.vipId) {
        if (!weekVips.has(slot.vipId)) weekVips.set(slot.vipId, []);
        weekVips.get(slot.vipId).push(d.label);
      }
    });

    weekVips.forEach((dayLabels, playerId) => {
      if (dayLabels.length > 1) {
        const p = getPlayerById(playerId);
        errors.push(
          `VIP en double dans le planning : ${p ? p.pseudo : playerId} (${dayLabels.join(', ')})`
        );
      }
    });

    WEEK_DAYS.forEach((d) => {
      const slot = plan.days[d.key] || {};
      if (slot.conductorId && slot.vipId && slot.conductorId === slot.vipId) {
        const p = getPlayerById(slot.conductorId);
        errors.push(
          `Conducteur aussi choisi comme VIP : ${p ? p.pseudo : slot.conductorId} (${d.label})`
        );
      }
      if (slot.vipId && weekConductors.has(slot.vipId) && slot.conductorId !== slot.vipId) {
        const p = getPlayerById(slot.vipId);
        errors.push(
          `VIP aussi conducteur cette semaine : ${p ? p.pseudo : slot.vipId} (${d.label})`
        );
      }
      if (slot.vipId && getVipIdsThisMonth().has(slot.vipId)) {
        const applied = getAppliedWeek(plan.weekId);
        const alreadyCounted =
          applied &&
          Array.isArray(applied.deltas) &&
          applied.deltas.some((dlt) => dlt.playerId === slot.vipId && dlt.vip > 0);
        if (!alreadyCounted) {
          const p = getPlayerById(slot.vipId);
          errors.push(`VIP déjà VIP ce mois : ${p ? p.pseudo : slot.vipId} (${d.label})`);
        }
      }
      if (slot.conductorId) pushPlayerEligibilityErrors(errors, slot.conductorId, d.label);
      if (slot.vipId) pushPlayerEligibilityErrors(errors, slot.vipId, d.label);
    });

    return [...new Set(errors)];
  }

  function validatePlanning() {
    return validateWeeklyPlanErrors();
  }

  function validateClosure() {
    const errors = validateWeeklyPlanErrors();
    const plan = getWeeklyPlan();

    ASSIGNABLE_DAYS.forEach((d) => {
      const slot = plan.days[d.key] || {};
      if (!slot.conductorId) errors.push(`Conducteur manquant : ${d.label}`);
      if (!slot.vipId) errors.push(`VIP manquant : ${d.label}`);
    });

    const sunday = plan.days.dimanche || {};
    if (!sunday.conductorId) errors.push('Conducteur manquant : Dimanche');
    if (!sunday.vipId) errors.push('VIP manquant : Dimanche');

    return [...new Set(errors)];
  }

  function archiveClosedWeeklyPlan() {
    const week = getCurrentWeek();
    const weekLabel = week ? week.label : 'Semaine';
    const plan = getWeeklyPlan();
    const weekId = plan.weekId || (week ? week.id : `plan_${currentMonthKey()}`);
    const monthKey = currentMonthKey();
    const now = new Date().toISOString();
    const planKey = buildWeeklyPlanKey(plan);
    const deltas = buildWeeklyPlanDeltas(plan);
    let result = 'applied';

    update((s) => {
      if (!s.appliedPlans) s.appliedPlans = {};
      if (!s.history) s.history = [];
      ensureMonthSeed(s, monthKey);
      syncWeeklyPlanToCurrentWeek(s);

      const previous = s.appliedPlans[weekId];

      // Même planning déjà compté : simple re-verrouillage sans toucher aux compteurs
      if (previous && previous.planKey === planKey && previous.deltas) {
        const actor = stampActor();
        previous.locked = true;
        previous.closedAt = now;
        previous.validatedAt = now;
        previous.closedByUserId = actor.actorUserId || '';
        previous.closedByPlayerId = actor.actorPlayerId || null;
        previous.closedBy = actor.actorLabel || '';
        s.appliedPlans[weekId] = previous;
        result = 'unchanged';
        return s;
      }

      if (previous && previous.deltas) {
        applyDeltas(s, previous.monthKey || monthKey, previous.deltas || [], 'reverse');
        const oldIds = new Set(previous.historyIds || []);
        s.history = s.history.filter((h) => !oldIds.has(h.id));
        result = 'adjusted';
      }

      applyDeltas(s, monthKey, deltas, 'apply');

      const historyIds = [];
      WEEK_DAYS.forEach((d) => {
        const slot = s.weeklyPlan.days[d.key] || {};
        if (!slot.conductorId && !slot.vipId) return;
        const histId = uid('hist');
        historyIds.push(histId);
        const cat =
          s.categories.find((c) => c.firstId === slot.conductorId) ||
          s.categories.find((c) => c.secondId === slot.conductorId) ||
          null;
        const conductorCounts = slot.conductorId
          ? readCountsFrom(s, monthKey, slot.conductorId)
          : null;
        const vipCounts = slot.vipId ? readCountsFrom(s, monthKey, slot.vipId) : null;
        s.history.unshift({
          id: histId,
          weekLabel,
          weekId,
          day: d.key,
          dayLabel: d.label,
          conductorId: slot.conductorId,
          conductorPseudo: getPlayerById(slot.conductorId)?.pseudo || '—',
          conductorCounters: conductorCounts
            ? `Conducteur ${conductorCounts.conductor} | VIP ${conductorCounts.vip}`
            : '',
          vipId: slot.vipId,
          vipPseudo: getPlayerById(slot.vipId)?.pseudo || '—',
          vipCounters: vipCounts
            ? `Conducteur ${vipCounts.conductor} | VIP ${vipCounts.vip}`
            : '',
          categoryId: cat?.id || null,
          categoryName: cat?.name || d.label,
          mode:
            slot.vipMode === 'tirage'
              ? 'Tirage'
              : slot.vipMode === 'merite'
                ? 'Mérite'
                : slot.vipMode === 'manuel'
                  ? 'Manuel'
                  : 'Planning',
          monthKey,
          createdAt: now,
        });
      });

      const actor = stampActor();
      s.appliedPlans[weekId] = {
        monthKey,
        planKey,
        deltas,
        historyIds,
        locked: true,
        closedAt: now,
        validatedAt: now,
        closedByUserId: actor.actorUserId || '',
        closedByPlayerId: actor.actorPlayerId || null,
        closedBy: actor.actorLabel || '',
      };
      return s;
    });

    return result;
  }

  function planHasAssignments(plan) {
    if (!plan?.days) return false;
    return WEEK_DAYS.some((d) => {
      const slot = plan.days[d.key] || {};
      return Boolean(slot.conductorId || slot.vipId);
    });
  }

  function categoriesHaveAssignments(categories) {
    return (categories || []).some((c) => c.firstId || c.secondId || c.vipId);
  }

  function buildWeekArchiveSnapshot(trainState, notificationText) {
    const week = getCurrentWeek();
    const plan = trainState.weeklyPlan || createBlankWeeklyPlan();
    const monthKey = currentMonthKey();
    const weekLabel = week ? week.label : 'Semaine';
    const weekDate = week
      ? [week.startDate, week.endDate].filter(Boolean).join(' → ') || week.label
      : null;

    const days = {};
    WEEK_DAYS.forEach((d) => {
      const slot = plan.days?.[d.key] || {};
      const conductorCounts = slot.conductorId
        ? readCountsFrom(trainState, monthKey, slot.conductorId)
        : null;
      const vipCounts = slot.vipId ? readCountsFrom(trainState, monthKey, slot.vipId) : null;
      days[d.key] = {
        dayLabel: d.label,
        conductorId: slot.conductorId || null,
        conductorPseudo: getPlayerById(slot.conductorId)?.pseudo || null,
        conductorCounters: conductorCounts,
        vipId: slot.vipId || null,
        vipPseudo: getPlayerById(slot.vipId)?.pseudo || null,
        vipCounters: vipCounts,
        vipMode: slot.vipMode || null,
      };
    });

    const categories = (trainState.categories || []).map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      firstId: c.firstId || null,
      firstPseudo: getPlayerById(c.firstId)?.pseudo || null,
      secondId: c.secondId || null,
      secondPseudo: getPlayerById(c.secondId)?.pseudo || null,
      vipId: c.vipId || null,
      vipPseudo: getPlayerById(c.vipId)?.pseudo || null,
    }));

    const weekCounters = {};
    const collectCounter = (playerId) => {
      if (!playerId || weekCounters[playerId]) return;
      weekCounters[playerId] = {
        pseudo: getPlayerById(playerId)?.pseudo || null,
        ...readCountsFrom(trainState, monthKey, playerId),
      };
    };
    WEEK_DAYS.forEach((d) => {
      const slot = days[d.key];
      collectCounter(slot.conductorId);
      collectCounter(slot.vipId);
    });
    categories.forEach((c) => {
      collectCounter(c.firstId);
      collectCounter(c.secondId);
      collectCounter(c.vipId);
    });

    return {
      id: uid('train_archive'),
      archivedAt: new Date().toISOString(),
      weekId: plan.weekId || null,
      vsWeekId: plan.vsWeekId != null ? plan.vsWeekId : plan.weekId,
      weekLabel,
      weekDate,
      monthKey,
      categories,
      days,
      weekCounters,
      notification: notificationText || '',
    };
  }

  /** Archive historique sans toucher aux compteurs mensuels. Ne supprime jamais. */
  function softArchivePlanningToHistory(trainState) {
    const plan = trainState.weeklyPlan;
    if (!plan) return;
    if (!planHasAssignments(plan) && !categoriesHaveAssignments(trainState.categories)) return;

    const week = getCurrentWeek();
    const weekLabel = week ? week.label : 'Semaine';
    const weekId = plan.weekId || (week ? week.id : `plan_${currentMonthKey()}`);
    const monthKey = currentMonthKey();
    const now = new Date().toISOString();
    const planKey = buildWeeklyPlanKey(plan);

    if (!trainState.appliedPlans) trainState.appliedPlans = {};
    if (!trainState.history) trainState.history = [];

    const previous = trainState.appliedPlans[weekId];
    if (previous) {
      // Déjà clôturée / archivée : ne jamais effacer historique ni compteurs
      previous.locked = true;
      if (!previous.closedAt) previous.closedAt = now;
      if (!previous.closedByUserId) {
        const actor = stampActor();
        previous.closedByUserId = actor.actorUserId || '';
        previous.closedByPlayerId = actor.actorPlayerId || null;
        previous.closedBy = actor.actorLabel || '';
      }
      trainState.appliedPlans[weekId] = previous;
      return;
    }

    const historyIds = [];
    WEEK_DAYS.forEach((d) => {
      const slot = plan.days[d.key] || {};
      if (!slot.conductorId && !slot.vipId) return;
      const histId = uid('hist');
      historyIds.push(histId);
      const cat =
        trainState.categories.find((c) => c.firstId === slot.conductorId) ||
        trainState.categories.find((c) => c.secondId === slot.conductorId) ||
        null;
      const conductorCounts = slot.conductorId
        ? readCountsFrom(trainState, monthKey, slot.conductorId)
        : null;
      const vipCounts = slot.vipId ? readCountsFrom(trainState, monthKey, slot.vipId) : null;
      trainState.history.unshift({
        id: histId,
        weekLabel,
        weekId,
        day: d.key,
        dayLabel: d.label,
        conductorId: slot.conductorId,
        conductorPseudo: getPlayerById(slot.conductorId)?.pseudo || '—',
        conductorCounters: conductorCounts
          ? `Conducteur ${conductorCounts.conductor} | VIP ${conductorCounts.vip}`
          : '',
        vipId: slot.vipId,
        vipPseudo: getPlayerById(slot.vipId)?.pseudo || '—',
        vipCounters: vipCounts
          ? `Conducteur ${vipCounts.conductor} | VIP ${vipCounts.vip}`
          : '',
        categoryId: cat?.id || null,
        categoryName: cat?.name || d.label,
        mode:
          slot.vipMode === 'tirage'
            ? 'Tirage'
            : slot.vipMode === 'merite'
              ? 'Mérite'
              : slot.vipMode === 'manuel'
                ? 'Manuel'
                : 'Planning',
        monthKey,
        createdAt: now,
        archivedVia: 'nouvelle_semaine',
      });
    });

    const actor = stampActor();
    trainState.appliedPlans[weekId] = {
      monthKey,
      planKey,
      deltas: [],
      historyIds,
      locked: true,
      closedAt: now,
      validatedAt: now,
      closedByUserId: actor.actorUserId || '',
      closedByPlayerId: actor.actorPlayerId || null,
      closedBy: actor.actorLabel || '',
      archivedVia: 'nouvelle_semaine',
    };
  }

  function clearCategoryAssignments(trainState) {
    (trainState.categories || []).forEach((cat) => {
      cat.firstId = null;
      cat.secondId = null;
      cat.vipId = null;
      cat.vipMode = null;
    });
  }

  async function createNewTrainWeek() {
    const ok = await AppUI.confirm({
      title: 'Nouvelle semaine',
      message:
        'La semaine actuelle va être archivée puis une nouvelle semaine sera créée.\n\nContinuer ?',
      confirmLabel: 'Créer la nouvelle semaine',
    });
    if (!ok) return;

    const plan = getWeeklyPlan();
    const notificationText =
      (els.notificationText?.textContent || '').trim() ||
      buildNotificationText(plan, isSundayFilled(plan) ? 'final' : 'provisional');

    update((s) => {
      if (!s.weekArchives) s.weekArchives = [];
      if (!s.history) s.history = [];
      if (!s.appliedPlans) s.appliedPlans = {};
      ensureMonthSeed(s, currentMonthKey());
      syncWeeklyPlanToCurrentWeek(s);

      // Snapshot complet (jamais de suppression d’archives)
      s.weekArchives.unshift(buildWeekArchiveSnapshot(s, notificationText));

      // Historique visible sans modifier les compteurs mensuels
      softArchivePlanningToHistory(s);

      // Réinitialiser uniquement le travail de la semaine
      clearCategoryAssignments(s);
      const vsWeekId = getCurrentWeek()?.id || null;
      s.weeklyPlan = createBlankWeeklyPlan(uid('trainweek'), vsWeekId);

      // monthlyCounts, history, appliedPlans, weekArchives inchangés (hors ajouts ci-dessus)
      return s;
    });

    vipDrawProposal = null;
    hideNotificationBlock();
    renderValidation(null);
    AppUI.toast('Nouvelle semaine créée. La précédente est archivée.');
  }

  /* ---------- DOM ---------- */

  function cacheDom() {
    els.root = document.getElementById('panel-train');
    els.categoriesList = document.getElementById('trainCategoriesList');
    els.btnAddCategory = document.getElementById('trainAddCategory');
    els.conductorsList = document.getElementById('trainConductorsList');
    els.btnAnalyze = document.getElementById('trainAnalyze');
    els.analyzeResult = document.getElementById('trainAnalyzeResult');
    els.weeklySubtitle = document.getElementById('trainWeeklySubtitle');
    els.weekPlan = document.getElementById('trainWeekPlan');
    els.weekCandidates = document.getElementById('trainWeekCandidates');
    els.vipDrawDay = document.getElementById('trainVipDrawDay');
    els.btnVipDraw = document.getElementById('trainVipDraw');
    els.vipDrawPanel = document.getElementById('trainVipDrawPanel');
    els.vipExclusionStats = document.getElementById('trainVipExclusionStats');
    els.btnValidateCheck = document.getElementById('trainValidateCheck');
    els.btnGenProvisional = document.getElementById('trainGenProvisional');
    els.btnGenFinal = document.getElementById('trainGenFinal');
    els.btnCloseWeek = document.getElementById('trainCloseWeek');
    els.btnUnlockWeek = document.getElementById('trainUnlockWeek');
    els.btnNewWeek = document.getElementById('trainNewWeek');
    els.validationResult = document.getElementById('trainValidationResult');
    els.lockBanner = document.getElementById('trainLockBanner');
    els.notificationBlock = document.getElementById('trainNotificationBlock');
    els.notificationSubtitle = document.getElementById('trainNotificationSubtitle');
    els.notificationText = document.getElementById('trainNotificationText');
    els.notificationCount = document.getElementById('trainNotificationCount');
    els.notificationAlert = document.getElementById('trainNotificationAlert');
    els.btnCopyNotification = document.getElementById('trainCopyNotification');
    els.copyFeedback = document.getElementById('trainCopyFeedback');
    els.historyBody = document.getElementById('trainHistoryBody');
    els.historyEmpty = document.getElementById('trainHistoryEmpty');
    els.replaceModal = document.getElementById('trainReplaceModal');
    els.replaceForm = document.getElementById('trainReplaceForm');
    els.replaceTitle = document.getElementById('trainReplaceTitle');
    els.replaceHint = document.getElementById('trainReplaceHint');
    els.replaceSelect = document.getElementById('trainReplaceSelect');
  }

  function vipDayOptions(selectedId, dayKey) {
    const eligible = getEligibleWeekVipPlayers(dayKey);
    const opts = ['<option value="">—</option>'];
    const seen = new Set();
    if (selectedId) {
      const selected = getPlayerById(selectedId);
      if (selected) {
        opts.push(
          `<option value="${selected.id}" selected>${escapeHtml(formatPlayerCounters(selected))}</option>`
        );
        seen.add(selected.id);
      }
    }
    eligible.forEach((p) => {
      if (seen.has(p.id)) return;
      opts.push(`<option value="${p.id}">${escapeHtml(formatPlayerCounters(p))}</option>`);
    });
    return opts.join('');
  }

  function conductorDayOptions(selectedId, dayKey) {
    const eligible = getEligibleWeekConductorPlayers(dayKey);
    const opts = ['<option value="">—</option>'];
    const seen = new Set();
    if (selectedId) {
      const selected = getPlayerById(selectedId);
      if (selected) {
        opts.push(
          `<option value="${selected.id}" selected>${escapeHtml(formatPlayerCounters(selected))}</option>`
        );
        seen.add(selected.id);
      }
    }
    eligible.forEach((p) => {
      if (seen.has(p.id)) return;
      opts.push(`<option value="${p.id}">${escapeHtml(formatPlayerCounters(p))}</option>`);
    });
    return opts.join('');
  }

  function renderVipExclusionStats() {
    if (!els.vipExclusionStats) return;
    const stats = getVipDrawExclusionStats(els.vipDrawDay?.value || vipDrawProposal?.dayKey);
    els.vipExclusionStats.innerHTML = `
      <div class="train-exclusion-card">
        <strong>Joueurs exclus du tirage : ${stats.totalExcluded}</strong>
        <ul>
          <li>Absents : ${stats.absents}</li>
          <li>Rouges : ${stats.rouges}</li>
          <li>Conducteurs : ${stats.conductors}</li>
          <li>VIP du mois : ${stats.vipMonth}</li>
        </ul>
      </div>
    `;
  }

  function playerOptions(selectedId, options = {}) {
    const players = getActivePlayers();
    const opts = ['<option value="">—</option>'];
    players.forEach((p) => {
      const disabled =
        options.disableIds && options.disableIds.has(p.id) && p.id !== selectedId
          ? ' disabled'
          : '';
      const label = formatPlayerCounters(p);
      const mark = p.absent ? ' (Absent)' : '';
      opts.push(
        `<option value="${p.id}" ${p.id === selectedId ? 'selected' : ''}${disabled}>${escapeHtml(
          label
        )}${mark}</option>`
      );
    });
    return opts.join('');
  }

  function renderCategories() {
    const cats = getState().categories;
    if (!cats.length) {
      els.categoriesList.innerHTML = '<p class="empty-state">Aucune catégorie. Créez-en une.</p>';
      return;
    }

    els.categoriesList.innerHTML = cats
      .map(
        (cat) => `
          <article class="train-cat-card" data-cat-id="${cat.id}">
            <div class="train-cat-top">
              <span class="badge badge-saison">Conducteur</span>
              <div class="player-actions">
                <button type="button" class="btn btn-ghost btn-sm" data-train-action="edit-cat" data-id="${cat.id}">Modifier</button>
                <button type="button" class="btn btn-danger btn-sm" data-train-action="delete-cat" data-id="${cat.id}">Supprimer</button>
              </div>
            </div>
            <h4 class="stack-item-title">${escapeHtml(cat.name)}</h4>
          </article>
        `
      )
      .join('');
  }

  function renderConductors() {
    const cats = getState().categories;
    els.conductorsList.innerHTML = cats
      .map(
        (cat) => `
          <div class="train-conductor-row" data-cat-id="${cat.id}">
            <div class="train-conductor-name">
              <strong>${escapeHtml(cat.name)}</strong>
            </div>
            <label class="field">
              <span>🥇 Premier</span>
              <select class="input" data-train-field="firstId" data-id="${cat.id}">
                ${playerOptions(cat.firstId)}
              </select>
            </label>
            <label class="field">
              <span>🥈 Deuxième</span>
              <select class="input" data-train-field="secondId" data-id="${cat.id}">
                ${playerOptions(cat.secondId)}
              </select>
            </label>
          </div>
        `
      )
      .join('');

    els.btnAnalyze.disabled = !allFirstFilled();
    els.btnAnalyze.title = allFirstFilled()
      ? 'Analyser les conflits entre premiers'
      : 'Renseignez tous les Premiers pour analyser';
  }

  function playerName(id) {
    const p = getPlayerById(id);
    return p ? p.pseudo : '—';
  }

  function renderWeekRoleLine(dayKey, field, playerId, locked) {
    const roleLabel = field === 'conductorId' ? 'Conducteur' : 'VIP';
    const name = playerId ? playerName(playerId) : '—';
    const btn = locked
      ? ''
      : `<button type="button" class="btn btn-ghost btn-sm" data-train-action="replace-week-role" data-day="${dayKey}" data-field="${field}">Modifier</button>`;
    return `
      <div class="train-day-assign">
        <span class="train-day-assign-label">${roleLabel} :</span>
        <strong class="train-day-assign-name">${escapeHtml(name)}</strong>
        ${btn}
      </div>
    `;
  }

  function renderWeekPlan() {
    if (!els.weekPlan) return;
    const plan = getWeeklyPlan();
    const week = getCurrentWeek();
    const locked = isCurrentWeekLocked();
    if (els.weeklySubtitle) {
      els.weeklySubtitle.textContent = week
        ? `${week.label} · Conducteurs & VIP — Lundi → Dimanche${locked ? ' · Clôturée' : ''}`
        : 'Conducteurs & VIP — Lundi → Dimanche';
    }

    els.weekPlan.innerHTML = WEEK_DAYS.map((day) => {
      const slot = plan.days[day.key] || {};
      const isSunday = day.key === 'dimanche';
      const conductorId = slot.conductorId || '';
      const vipId = slot.vipId || '';

      if (isSunday) {
        return `
          <article class="train-day-card train-day-sunday">
            <header>
              <strong>${day.label}</strong>
              <span class="chip warn">Jeu en direct</span>
            </header>
            <p class="panel-subtitle">Facultatif pendant la préparation — à renseigner pour la clôture · modification manuelle possible</p>
            ${renderWeekRoleLine(day.key, 'conductorId', conductorId, locked)}
            ${renderWeekRoleLine(day.key, 'vipId', vipId, locked)}
          </article>
        `;
      }

      return `
        <article class="train-day-card">
          <header>
            <strong>${day.label}</strong>
          </header>
          <div class="train-day-slot">
            ${renderWeekRoleLine(day.key, 'conductorId', conductorId, locked)}
          </div>
          <div class="train-day-slot">
            ${renderWeekRoleLine(day.key, 'vipId', vipId, locked)}
          </div>
        </article>
      `;
    }).join('');
  }

  function openReplaceModal(dayKey, field) {
    if (isCurrentWeekLocked()) {
      AppUI.toast('Semaine clôturée — déverrouillage R5 requis.');
      return;
    }
    if (!els.replaceModal || !els.replaceSelect) return;
    const day = WEEK_DAYS.find((d) => d.key === dayKey);
    const roleLabel = field === 'conductorId' ? 'Conducteur' : 'VIP';
    const currentId =
      field === 'conductorId'
        ? getWeeklyPlan().days[dayKey]?.conductorId
        : getWeeklyPlan().days[dayKey]?.vipId;
    const eligible =
      field === 'conductorId'
        ? getEligibleWeekConductorPlayers(dayKey)
        : getEligibleWeekVipPlayers(dayKey);

    replaceContext = { dayKey, field };
    if (els.replaceTitle) {
      els.replaceTitle.textContent = `Modifier — ${roleLabel} (${day?.label || dayKey})`;
    }
    if (els.replaceHint) {
      els.replaceHint.textContent = currentId
        ? `Actuel : ${playerName(currentId)}. Choisissez un remplaçant éligible (le tirage n’est pas relancé).`
        : `Aucun ${roleLabel.toLowerCase()} actuellement. Choisissez un joueur éligible.`;
    }

    const opts = ['<option value="">— Choisir —</option>'];
    eligible.forEach((p) => {
      if (p.id === currentId) return;
      opts.push(
        `<option value="${p.id}">${escapeHtml(formatPlayerCounters(p))}</option>`
      );
    });
    els.replaceSelect.innerHTML = opts.join('');
    if (!eligible.filter((p) => p.id !== currentId).length) {
      AppUI.toast(`Aucun ${roleLabel.toLowerCase()} éligible disponible.`);
      return;
    }
    if (typeof els.replaceModal.showModal === 'function') els.replaceModal.showModal();
  }

  function closeReplaceModal() {
    replaceContext = null;
    if (els.replaceModal?.open) els.replaceModal.close();
  }

  async function submitReplaceModal(event) {
    event.preventDefault();
    if (!replaceContext) return;
    const { dayKey, field } = replaceContext;
    const nextId = (els.replaceSelect?.value || '').trim();
    if (!nextId) {
      AppUI.toast('Sélectionnez un joueur éligible.');
      return;
    }
    const roleLabel = field === 'conductorId' ? 'Conducteur' : 'VIP';
    const day = WEEK_DAYS.find((d) => d.key === dayKey);
    const ok = await AppUI.confirm({
      title: `Remplacer le ${roleLabel}`,
      message: `${day?.label || dayKey} — ${roleLabel} : ${playerName(nextId)} ?\n\nSeule cette affectation sera modifiée.`,
      confirmLabel: 'Valider',
    });
    if (!ok) return;
    setWeekDayField(dayKey, field, nextId);
    closeReplaceModal();
    AppUI.toast(`${roleLabel} mis à jour — planning officiel de la semaine.`);
  }

  function renderWeekCandidates() {
    if (!els.weekCandidates) return;
    const candidates = getFirstCandidates();
    const taken = getWeekConductorIds();
    const locked = isCurrentWeekLocked();
    const dayOptions = ASSIGNABLE_DAYS.map(
      (d) => `<option value="${d.key}">${d.label}</option>`
    ).join('');

    if (!candidates.length) {
      els.weekCandidates.innerHTML =
        '<p class="empty-state">Aucun Premier renseigné dans les catégories.</p>';
      return;
    }

    els.weekCandidates.innerHTML = candidates
      .map((c) => {
        const counts = getPlayerMonthCounts(c.playerId);
        const already = taken.has(c.playerId);
        const disabled = locked || already;
        return `
          <article class="train-candidate-card">
            <div>
              <h4 class="stack-item-title">${escapeHtml(c.player.pseudo)}</h4>
              <div class="player-meta" style="margin-top:0.35rem">
                <span class="badge badge-saison">${escapeHtml(c.categoryName)}</span>
                <span class="chip muted">Conducteur ${counts.conductor} ce mois</span>
              </div>
            </div>
            <div class="train-assign-controls">
              <select class="input" data-assign-day ${disabled ? 'disabled' : ''}>
                ${dayOptions}
              </select>
              <button
                type="button"
                class="btn btn-primary btn-sm"
                data-train-action="assign-candidate"
                data-player="${c.playerId}"
                ${disabled ? 'disabled' : ''}
              >${locked ? 'Verrouillé' : already ? 'Déjà conducteur' : 'Affecter'}</button>
            </div>
          </article>
        `;
      })
      .join('');
  }

  function renderWeeklyScreen() {
    renderWeekPlan();
    renderWeekCandidates();
    renderVipDrawDaySelect();
    renderVipDrawPanel();
    renderVipExclusionStats();
  }

  function assignCandidateToDay(playerId, dayKey) {
    if (!playerId) return;
    if (isCurrentWeekLocked()) {
      AppUI.toast('Semaine clôturée — déverrouillage R5 requis.');
      return;
    }
    if (!ASSIGNABLE_DAYS.some((d) => d.key === dayKey)) {
      AppUI.toast('Choisissez un jour de Lundi à Samedi.');
      return;
    }
    const player = getPlayerById(playerId);
    if (!isEligibleForWeekConductor(player, dayKey)) {
      AppUI.toast('Joueur non éligible comme conducteur (Absent, Rouge/Orange ou déjà conducteur).');
      return;
    }
    if (getWeekConductorIds().has(playerId)) {
      AppUI.toast('Ce joueur conduit déjà cette semaine.');
      return;
    }
    update((s) => {
      syncWeeklyPlanToCurrentWeek(s);
      const slot = s.weeklyPlan.days[dayKey];
      ASSIGNABLE_DAYS.forEach((d) => {
        if (s.weeklyPlan.days[d.key].conductorId === playerId) {
          s.weeklyPlan.days[d.key].conductorId = null;
        }
      });
      slot.conductorId = playerId;
      if (slot.vipId === playerId) {
        slot.vipId = null;
        slot.vipMode = null;
      }
      return s;
    });
    AppUI.toast(`Conducteur affecté au ${WEEK_DAYS.find((d) => d.key === dayKey).label}.`);
  }

  function setWeekDayField(dayKey, field, value) {
    if (isCurrentWeekLocked()) {
      AppUI.toast('Semaine clôturée — déverrouillage R5 requis.');
      render();
      return;
    }
    const player = value ? getPlayerById(value) : null;
    if (field === 'conductorId' && value) {
      if (!isEligibleForWeekConductor(player, dayKey)) {
        AppUI.toast('Conducteur non éligible (Absent, Rouge/Orange ou déjà conducteur).');
        render();
        return;
      }
    }
    if (field === 'vipId' && value) {
      if (!isEligibleForWeekVip(player, dayKey)) {
        AppUI.toast('VIP non éligible — règles Train non respectées.');
        render();
        return;
      }
    }

    update((s) => {
      syncWeeklyPlanToCurrentWeek(s);
      if (!s.weeklyPlan.days[dayKey]) {
        s.weeklyPlan.days[dayKey] = { conductorId: null, vipId: null, vipMode: null };
      }
      if (field === 'conductorId' && value) {
        const conflictDays =
          dayKey === 'dimanche'
            ? []
            : ASSIGNABLE_DAYS.filter(
                (d) => d.key !== dayKey && s.weeklyPlan.days[d.key].conductorId === value
              );
        if (conflictDays.length) {
          AppUI.toast('Ce joueur conduit déjà un autre jour (Lun–Sam).');
          return s;
        }
        // Si ce joueur était VIP ce jour-là, retirer le VIP (conducteur ≠ VIP)
        if (s.weeklyPlan.days[dayKey].vipId === value) {
          s.weeklyPlan.days[dayKey].vipId = null;
          s.weeklyPlan.days[dayKey].vipMode = null;
        }
      }
      s.weeklyPlan.days[dayKey][field] = value || null;
      if (field === 'vipId') {
        s.weeklyPlan.days[dayKey].vipMode = value ? 'manuel' : null;
      }
      return s;
    });
    // La version manuelle devient officielle : notif / stats / exports se recalculent via render
    if (els.notificationBlock && !els.notificationBlock.classList.contains('hidden')) {
      showNotificationBlock(
        buildNotificationText(getWeeklyPlan(), 'provisional'),
        'Notification provisoire (planning mis à jour)'
      );
    }
  }

  function clearWeekConductor(dayKey) {
    if (isCurrentWeekLocked()) {
      AppUI.toast('Semaine clôturée — déverrouillage R5 requis.');
      return;
    }
    setWeekDayField(dayKey, 'conductorId', null);
  }

  function clearWeekVip(dayKey) {
    if (isCurrentWeekLocked()) {
      AppUI.toast('Semaine clôturée — déverrouillage R5 requis.');
      return;
    }
    update((s) => {
      syncWeeklyPlanToCurrentWeek(s);
      s.weeklyPlan.days[dayKey].vipId = null;
      s.weeklyPlan.days[dayKey].vipMode = null;
      return s;
    });
  }

  function buildNotificationText(plan, mode = 'provisional') {
    const lines = [];
    ASSIGNABLE_DAYS.forEach((d) => {
      const slot = plan.days[d.key] || {};
      if (!slot.conductorId && !slot.vipId) return;
      const conductor = slot.conductorId ? playerName(slot.conductorId) : '';
      const vip = slot.vipId ? playerName(slot.vipId) : '';
      lines.push(`${d.label} | Conducteur : ${conductor} | VIP : ${vip}`);
    });
    if (mode === 'final' && isSundayFilled(plan)) {
      const sunday = plan.days.dimanche || {};
      lines.push(
        `Dimanche | Conducteur : ${playerName(sunday.conductorId)} | VIP : ${playerName(sunday.vipId)}`
      );
    }
    return lines.join('\n');
  }

  function showNotificationBlock(text, subtitle) {
    if (!els.notificationBlock) return;
    els.notificationBlock.classList.remove('hidden');
    if (els.notificationSubtitle && subtitle) {
      els.notificationSubtitle.textContent = subtitle;
    }
    els.notificationText.textContent = text;
    const len = text.length;
    els.notificationCount.textContent = `${len} / 500`;
    els.notificationAlert.classList.toggle('hidden', len <= 500);
    if (els.copyFeedback) els.copyFeedback.classList.add('hidden');
  }

  function refreshActionButtons() {
    const plan = getWeeklyPlan();
    const locked = isCurrentWeekLocked();
    const sundayOk = isSundayFilled(plan);
    const closureErrors = validateClosure();

    if (els.btnGenProvisional) els.btnGenProvisional.disabled = locked;
    if (els.btnGenFinal) els.btnGenFinal.disabled = locked || !sundayOk;
    if (els.btnCloseWeek) els.btnCloseWeek.disabled = locked || closureErrors.length > 0;
    if (els.btnUnlockWeek) {
      els.btnUnlockWeek.classList.toggle('hidden', !locked || !isR5());
    }
    if (els.lockBanner) {
      els.lockBanner.classList.toggle('hidden', !locked);
      if (locked) {
        const applied = getAppliedWeek(getWeeklyPlan().weekId);
        const by =
          global.ROSProfiles && typeof ROSProfiles.resolveActor === 'function'
            ? ROSProfiles.resolveActor(applied || {})
            : applied?.closedBy || '';
        els.lockBanner.textContent = by && by !== '—'
          ? `Semaine clôturée par ${by} — modifications verrouillées (déverrouillage R5 uniquement)`
          : 'Semaine clôturée — modifications verrouillées (déverrouillage R5 uniquement)';
      }
    }
  }

  function generateProvisionalNotification() {
    const plan = getWeeklyPlan();
    const text = buildNotificationText(plan, 'provisional');
    if (!text.trim()) {
      AppUI.toast('Aucun jour renseigné du lundi au samedi.');
      return;
    }
    showNotificationBlock(text, 'Notification provisoire (lundi → samedi, sans dimanche)');
    AppUI.toast('Notification provisoire générée — compteurs inchangés.');
  }

  function generateFinalNotification() {
    const plan = getWeeklyPlan();
    if (!isSundayFilled(plan)) {
      AppUI.toast('Renseignez le Conducteur et le VIP du dimanche.');
      return;
    }
    const text = buildNotificationText(plan, 'final');
    showNotificationBlock(text, 'Notification finale (avec dimanche)');
    AppUI.toast('Notification finale générée — compteurs inchangés.');
  }

  function hideNotificationBlock() {
    if (!els.notificationBlock) return;
    els.notificationBlock.classList.add('hidden');
    if (els.copyFeedback) els.copyFeedback.classList.add('hidden');
  }

  async function copyNotification() {
    const text = els.notificationText?.textContent || '';
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
    if (els.copyFeedback) {
      els.copyFeedback.classList.remove('hidden');
    }
    AppUI.toast('Notification copiée');
  }

  function renderAnalyzeResult(payload) {
    if (!payload) {
      els.analyzeResult.innerHTML = '';
      return;
    }
    els.analyzeResult.innerHTML = payload;
  }

  function renderValidation(errors) {
    if (!errors) {
      els.validationResult.innerHTML = '';
      refreshActionButtons();
      return;
    }
    if (!errors.length) {
      const ready = validateClosure().length === 0;
      els.validationResult.innerHTML = ready
        ? '<div class="train-ok">Aucune erreur détectée. La semaine peut être clôturée.</div>'
        : '<div class="train-ok">Aucune erreur de doublon / éligibilité. Complétez lundi→samedi et le dimanche pour clôturer. La notification provisoire reste disponible.</div>';
      refreshActionButtons();
      return;
    }
    els.validationResult.innerHTML = `
      <div class="train-errors">
        <strong>Erreurs détectées</strong>
        <ul>${errors.map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul>
      </div>
    `;
    refreshActionButtons();
  }

  function renderHistory() {
    const history = getState().history;
    if (!history.length) {
      els.historyBody.innerHTML = '';
      els.historyEmpty.classList.remove('hidden');
      return;
    }
    els.historyEmpty.classList.add('hidden');
    els.historyBody.innerHTML = history
      .map((h) => {
        const monthKey = historyMonthKey(h) || currentMonthKey();
        const conductorName = h.conductorId
          ? ROSModels.getPlayerDisplayName(getAllianceState(), h.conductorId, h.conductorPseudo || '—')
          : h.conductorPseudo || '—';
        const vipName = h.vipId
          ? ROSModels.getPlayerDisplayName(getAllianceState(), h.vipId, h.vipPseudo || '—')
          : h.vipPseudo || '—';
        const conductorLabel = h.conductorId
          ? `${conductorName} — ${formatCountersShort(h.conductorId, monthKey)}`
          : conductorName;
        const vipLabel = h.vipId
          ? `${vipName} — ${formatCountersShort(h.vipId, monthKey)}`
          : vipName;
        return `
        <tr>
          <td>${escapeHtml(h.weekLabel)}<div class="panel-subtitle">${escapeHtml(monthKey)}</div></td>
          <td>${escapeHtml(h.dayLabel || h.day || '—')}</td>
          <td>${escapeHtml(conductorLabel)}</td>
          <td>${escapeHtml(vipLabel)}</td>
          <td>${escapeHtml(h.categoryName || '—')}</td>
          <td>${escapeHtml(h.mode || '—')}</td>
        </tr>
      `;
      })
      .join('');
  }

  function migratePlayerIdentity(players, options = {}) {
    const s = getState();
    const result = ROSPlayerIdentity
      ? ROSPlayerIdentity.migrateTrainState(s, players || getAllianceState().players, options)
      : { changed: false };
    if (result.changed) persist();
    return result.changed;
  }

  function render() {
    if (!els.root) return;
    // Nouveau mois : compteurs à 0 (seed une seule fois), mois précédents conservés
    const monthKey = currentMonthKey();
    const trainState = getState();
    if (!trainState.seedAppliedMonths.includes(monthKey)) {
      ensureMonthSeed(trainState, monthKey);
      persist();
    }
    const previousWeekId = trainState.weeklyPlan?.weekId;
    syncWeeklyPlanToCurrentWeek(trainState);
    if (trainState.weeklyPlan?.weekId !== previousWeekId) persist();
    renderCategories();
    renderConductors();
    renderWeeklyScreen();
    renderHistory();
    refreshActionButtons();
  }

  /* ---------- Actions ---------- */

  async function addCategory() {
    const name = window.prompt('Nom de la nouvelle catégorie :', 'Nouvelle catégorie');
    if (!name || !name.trim()) return;

    update((s) => {
      s.categories.push(makeCategory(name.trim(), 'saison'));
      return s;
    });
    AppUI.toast('Catégorie créée.');
  }

  async function editCategory(id) {
    const cat = getState().categories.find((c) => c.id === id);
    if (!cat) return;
    const name = window.prompt('Nouveau nom de la catégorie :', cat.name);
    if (!name || !name.trim()) return;

    update((s) => {
      const target = s.categories.find((c) => c.id === id);
      if (target) target.name = name.trim();
      return s;
    });
    AppUI.toast('Catégorie modifiée.');
  }

  async function deleteCategory(id) {
    const cat = getState().categories.find((c) => c.id === id);
    if (!cat) return;
    const ok = await AppUI.confirm({
      title: 'Supprimer la catégorie',
      message: `Supprimer « ${cat.name} » ? L’historique Train n’est pas effacé.`,
      confirmLabel: 'Supprimer',
    });
    if (!ok) return;
    update((s) => {
      s.categories = s.categories.filter((c) => c.id !== id);
      return s;
    });
    AppUI.toast('Catégorie supprimée.');
  }

  function setCategoryField(id, field, value) {
    update((s) => {
      const cat = s.categories.find((c) => c.id === id);
      if (!cat) return s;
      cat[field] = value || null;
      if (field === 'firstId' || field === 'secondId') {
        // Mode classement pour le conducteur choisi manuellement
      }
      return s;
    });
  }

  function analyzeConductors() {
    if (!allFirstFilled()) {
      AppUI.toast('Renseignez tous les Premiers avant d’analyser.');
      return;
    }
    const conflicts = findFirstConflicts();
    if (!conflicts.length) {
      renderAnalyzeResult('<div class="train-ok">Aucun conflit détecté</div>');
      return;
    }

    const html = conflicts
      .map((conflict) => {
        const options = conflict.categories
          .map(
            (cat) => `
            <label class="decision-item">
              <input type="radio" name="keep_${conflict.playerId}" value="${cat.id}" />
              <span class="decision-content">
                <strong>Garder dans ${escapeHtml(cat.name)}</strong>
                <small>Les autres Premiers seront vidés</small>
              </span>
            </label>
          `
          )
          .join('');

        return `
          <div class="block train-conflict" data-conflict-player="${conflict.playerId}">
            <header class="block-header">
              <h3>Conflit — ${escapeHtml(conflict.player?.pseudo || 'Joueur')}</h3>
              <p>Présent comme Premier dans :</p>
            </header>
            <ul class="train-conflict-list">
              ${conflict.categories.map((c) => `<li>${escapeHtml(c.name)}</li>`).join('')}
            </ul>
            <p class="panel-subtitle">Choisissez la catégorie qui conserve ce joueur. Les autres resteront vides.</p>
            <div class="stack-list">${options}</div>
            <button type="button" class="btn btn-primary btn-sm" data-train-action="resolve-conflict" data-player="${conflict.playerId}">
              Appliquer le choix
            </button>
          </div>
        `;
      })
      .join('');

    renderAnalyzeResult(`
      <div class="block">
        <header class="block-header">
          <h3>Conflits</h3>
          <p>Le logiciel ne décide pas — à vous de trancher</p>
        </header>
        ${html}
      </div>
    `);
  }

  function resolveConflict(playerId) {
    const checked = els.analyzeResult.querySelector(
      `input[name="keep_${playerId}"]:checked`
    );
    if (!checked) {
      AppUI.toast('Choisissez la catégorie à conserver.');
      return;
    }
    const keepCatId = checked.value;
    update((s) => {
      s.categories.forEach((cat) => {
        if (cat.firstId === playerId && cat.id !== keepCatId) {
          cat.firstId = null;
        }
      });
      return s;
    });
    AppUI.toast('Conflit résolu.');
    analyzeConductors();
  }

  async function closeTrainWeek() {
    const errors = validateClosure();
    if (errors.length) {
      renderValidation(errors);
      return;
    }
    const ok = await AppUI.confirm({
      title: 'Clôturer la semaine Train',
      message:
        'Archiver la semaine, mettre à jour les compteurs Conducteur / VIP, puis verrouiller les modifications ?',
      confirmLabel: 'Clôturer',
    });
    if (!ok) return;
    const result = archiveClosedWeeklyPlan();
    if (result === 'unchanged') {
      AppUI.toast('Cette semaine est déjà clôturée — compteurs inchangés.');
    } else if (result === 'adjusted') {
      AppUI.toast('Semaine reclôturée — compteurs mensuels ajustés.');
    } else {
      AppUI.toast('Semaine clôturée — compteurs Conducteur / VIP mis à jour.');
    }
    renderValidation([]);
    showNotificationBlock(
      buildNotificationText(getWeeklyPlan(), 'final'),
      'Notification finale après clôture'
    );
  }

  async function unlockTrainWeek() {
    if (!isR5()) {
      AppUI.toast('Seul le R5 peut déverrouiller la semaine.');
      return;
    }
    if (!isCurrentWeekLocked()) return;
    const ok = await AppUI.confirm({
      title: 'Déverrouiller la semaine',
      message:
        'Autoriser à nouveau les modifications du planning ? Les compteurs restent tels quels jusqu’à une nouvelle clôture.',
      confirmLabel: 'Déverrouiller',
    });
    if (!ok) return;
    update((s) => {
      syncWeeklyPlanToCurrentWeek(s);
      const weekId = s.weeklyPlan.weekId;
      if (s.appliedPlans[weekId]) {
        s.appliedPlans[weekId].locked = false;
      }
      return s;
    });
    AppUI.toast('Semaine déverrouillée (R5).');
  }

  function onRootClick(event) {
    const btn = event.target.closest('[data-train-action]');
    if (!btn) return;
    const { trainAction, id, player } = btn.dataset;

    if (trainAction === 'edit-cat') editCategory(id);
    if (trainAction === 'delete-cat') deleteCategory(id);
    if (trainAction === 'resolve-conflict') resolveConflict(player);
    if (trainAction === 'assign-candidate') {
      const card = btn.closest('.train-candidate-card');
      const daySelect = card?.querySelector('[data-assign-day]');
      assignCandidateToDay(player, daySelect?.value);
    }
    if (trainAction === 'clear-week-conductor') clearWeekConductor(btn.dataset.day);
    if (trainAction === 'clear-week-vip') clearWeekVip(btn.dataset.day);
    if (trainAction === 'replace-week-role') {
      openReplaceModal(btn.dataset.day, btn.dataset.field);
    }
    if (trainAction === 'vip-redraw') {
      runVipDraw(vipDrawProposal?.dayKey || els.vipDrawDay?.value);
    }
    if (trainAction === 'vip-validate-draw') validateVipDraw();
  }

  function onRootChange(event) {
    const select = event.target.closest('[data-train-field]');
    if (select) {
      setCategoryField(select.dataset.id, select.dataset.trainField, select.value);
      renderAnalyzeResult('');
      renderValidation(null);
      return;
    }

    if (event.target.id === 'trainVipDrawDay') {
      vipDrawProposal = null;
      renderVipDrawPanel();
      renderVipExclusionStats();
      return;
    }

    const weekField = event.target.closest('[data-week-field]');
    if (weekField) {
      setWeekDayField(weekField.dataset.day, weekField.dataset.weekField, weekField.value);
    }
  }

  function init() {
    cacheDom();
    loadState();

    if (els.btnAddCategory) {
      els.btnAddCategory.addEventListener('click', () => addCategory());
    }
    els.btnAnalyze.addEventListener('click', analyzeConductors);
    els.btnValidateCheck.addEventListener('click', () => {
      renderValidation(validateWeeklyPlanErrors());
    });
    if (els.btnVipDraw) {
      els.btnVipDraw.addEventListener('click', () => {
        runVipDraw(els.vipDrawDay?.value || 'lundi');
      });
    }
    if (els.btnGenProvisional) {
      els.btnGenProvisional.addEventListener('click', generateProvisionalNotification);
    }
    if (els.btnGenFinal) {
      els.btnGenFinal.addEventListener('click', generateFinalNotification);
    }
    if (els.btnCloseWeek) {
      els.btnCloseWeek.addEventListener('click', closeTrainWeek);
    }
    if (els.btnUnlockWeek) {
      els.btnUnlockWeek.addEventListener('click', unlockTrainWeek);
    }
    if (els.btnNewWeek) {
      els.btnNewWeek.addEventListener('click', createNewTrainWeek);
    }
    if (els.btnCopyNotification) {
      els.btnCopyNotification.addEventListener('click', copyNotification);
    }

    els.root.addEventListener('click', onRootClick);
    els.root.addEventListener('change', onRootChange);

    if (els.replaceForm) {
      els.replaceForm.addEventListener('submit', submitReplaceModal);
    }
    if (els.replaceModal) {
      els.replaceModal.querySelectorAll('[data-close-modal]').forEach((btn) => {
        btn.addEventListener('click', closeReplaceModal);
      });
      els.replaceModal.addEventListener('cancel', (event) => {
        event.preventDefault();
        closeReplaceModal();
      });
    }
  }

  global.TrainModule = {
    init,
    render,
    hydrateFromStorage,
    STORAGE_KEY,
    getPlayerMonthCounts,
    formatPlayerCounters,
    formatCountersShort,
    currentMonthKey,
    migratePlayerIdentity,
    getVipDrawExclusionStats,
    isEligibleForWeekVip,
    isEligibleForWeekConductor,
  };
})(window);
