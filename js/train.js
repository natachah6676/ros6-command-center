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
  /** Tri tableau d’équité (mémoire UI uniquement). */
  let equitySort = 'alpha';
  /**
   * Remplacement manuel :
   * - semaine courante : { source:'week', dayKey, field }
   * - archive plate : { source:'history', historyId, field }
   * - historique officiel : { source:'official', weekId, dayKey, field }
   */
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
      version: 3,
      categories: defaultCategories(),
      history: [],
      /** Historique officiel Train (source de vérité des stats depuis le début WarOps). */
      officialWeeks: [],
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
        version: 3,
        categories,
        history: Array.isArray(parsed.history) ? parsed.history : [],
        officialWeeks: normalizeOfficialWeeks(parsed.officialWeeks),
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

  function canCorrectTrainArchive() {
    if (global.ROSProfiles && typeof ROSProfiles.isActiveR4OrR5 === 'function') {
      return Boolean(ROSProfiles.isActiveR4OrR5());
    }
    const role = getAppRole();
    return role === 'R4' || role === 'R5';
  }

  function deltasFromHistoryEntries(entries) {
    const conductorIds = new Set();
    const vipIds = new Set();
    (entries || []).forEach((entry) => {
      if (entry?.conductorId) conductorIds.add(entry.conductorId);
      if (entry?.vipId) vipIds.add(entry.vipId);
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

  function historyEntriesForWeek(trainState, weekId) {
    if (!weekId) return [];
    return (trainState.history || []).filter((h) => h && h.weekId === weekId);
  }

  function refreshHistoryCounterLabels(trainState, monthKey) {
    (trainState.history || []).forEach((entry) => {
      if (!entry || historyMonthKey(entry) !== monthKey) return;
      if (entry.conductorId) {
        const counts = readCountsFrom(trainState, monthKey, entry.conductorId);
        entry.conductorCounters = `Conducteur ${counts.conductor} | VIP ${counts.vip}`;
        entry.conductorPseudo =
          getPlayerById(entry.conductorId)?.pseudo || entry.conductorPseudo || '—';
      }
      if (entry.vipId) {
        const counts = readCountsFrom(trainState, monthKey, entry.vipId);
        entry.vipCounters = `Conducteur ${counts.conductor} | VIP ${counts.vip}`;
        entry.vipPseudo = getPlayerById(entry.vipId)?.pseudo || entry.vipPseudo || '—';
      }
    });
  }

  function syncWeekArchiveDay(trainState, weekId, dayKey, patch) {
    if (!weekId || !dayKey || !patch) return;
    (trainState.weekArchives || []).forEach((arch) => {
      if (!arch || arch.weekId !== weekId || !arch.days || !arch.days[dayKey]) return;
      Object.assign(arch.days[dayKey], patch);
      if (!arch.weekCounters) arch.weekCounters = {};
      const monthKey = arch.monthKey || currentMonthKey();
      ['conductorId', 'vipId'].forEach((field) => {
        const playerId = arch.days[dayKey][field];
        if (!playerId) return;
        arch.weekCounters[playerId] = {
          pseudo: getPlayerById(playerId)?.pseudo || arch.weekCounters[playerId]?.pseudo || null,
          ...readCountsFrom(trainState, monthKey, playerId),
        };
      });
    });
  }

  /* ---------- Historique officiel (source de vérité stats depuis le début) ---------- */

  function getSupabaseClient() {
    return global.ROSSupabase && typeof ROSSupabase.getClient === 'function'
      ? ROSSupabase.getClient()
      : null;
  }

  function getSessionUserId() {
    const session =
      global.ROSSync && typeof ROSSync.getSession === 'function' ? ROSSync.getSession() : null;
    return session?.user?.id || null;
  }

  function emptyOfficialDays() {
    const days = {};
    WEEK_DAYS.forEach((d) => {
      days[d.key] = {
        conductorId: null,
        conductorPseudo: null,
        vipId: null,
        vipPseudo: null,
      };
    });
    return days;
  }

  function normalizeOfficialDay(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    return {
      conductorId: src.conductorId || src.conductor_player_id || null,
      conductorPseudo: src.conductorPseudo || src.conductor_pseudo || null,
      vipId: src.vipId || src.vip_player_id || null,
      vipPseudo: src.vipPseudo || src.vip_pseudo || null,
    };
  }

  function normalizeOfficialWeek(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const days = emptyOfficialDays();
    WEEK_DAYS.forEach((d) => {
      days[d.key] = normalizeOfficialDay(raw.days?.[d.key]);
    });
    return {
      id: raw.id || uid('thw'),
      weekKey: String(raw.weekKey || raw.week_key || raw.id || ''),
      weekLabel: String(raw.weekLabel || raw.week_label || 'Semaine'),
      weekStartDate: raw.weekStartDate || raw.week_start_date || null,
      weekEndDate: raw.weekEndDate || raw.week_end_date || null,
      source: ['close', 'init', 'correction'].includes(raw.source) ? raw.source : 'close',
      createdAt: raw.createdAt || raw.created_at || new Date().toISOString(),
      updatedAt: raw.updatedAt || raw.updated_at || new Date().toISOString(),
      days,
    };
  }

  function normalizeOfficialWeeks(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map(normalizeOfficialWeek).filter((w) => w && w.weekKey);
  }

  function getOfficialWeeks() {
    const s = getState();
    if (!Array.isArray(s.officialWeeks)) s.officialWeeks = [];
    return s.officialWeeks;
  }

  /** Compteurs historiques calculés (jamais stockés comme source de vérité). */
  function getHistoricalCounts(playerId) {
    if (!playerId) return { conductor: 0, vip: 0 };
    let conductor = 0;
    let vip = 0;
    getOfficialWeeks().forEach((week) => {
      WEEK_DAYS.forEach((d) => {
        const slot = week.days?.[d.key];
        if (!slot) return;
        if (slot.conductorId === playerId) conductor += 1;
        if (slot.vipId === playerId) vip += 1;
      });
    });
    return { conductor, vip };
  }

  function getHistoryAvailableSinceLabel() {
    const weeks = getOfficialWeeks();
    if (!weeks.length) return null;
    let best = null;
    weeks.forEach((w) => {
      const candidate = w.weekStartDate || (w.createdAt ? w.createdAt.slice(0, 10) : null);
      if (!candidate) return;
      if (!best || candidate < best) best = candidate;
    });
    if (!best) return null;
    try {
      return new Date(`${best}T12:00:00`).toLocaleDateString('fr-FR');
    } catch (error) {
      return best;
    }
  }

  function formatHistoricalShort(playerId) {
    const c = getHistoricalCounts(playerId);
    return `Conducteur : ${c.conductor} · VIP : ${c.vip}`;
  }

  function formatPlayerWithHistorical(player) {
    if (!player) return '';
    return `${player.pseudo} — ${formatHistoricalShort(player.id)}`;
  }

  /**
   * Parmi les éligibles, ne tire que ceux au minimum historique (VIP ou Conducteur).
   * Ne s’applique qu’aux vrais tirages — jamais au mérite manuel.
   */
  function pickFairByHistorical(eligiblePlayers, role) {
    const list = (eligiblePlayers || []).filter(Boolean);
    if (!list.length) return null;
    const field = role === 'conductor' ? 'conductor' : 'vip';
    let min = Infinity;
    list.forEach((p) => {
      const n = getHistoricalCounts(p.id)[field];
      if (n < min) min = n;
    });
    const pool = list.filter((p) => getHistoricalCounts(p.id)[field] === min);
    const index = Math.floor(Math.random() * pool.length);
    return pool[index] || null;
  }

  function buildOfficialWeekPayload({ weekKey, weekLabel, weekStartDate, weekEndDate, source, days }) {
    const now = new Date().toISOString();
    const existing = getOfficialWeeks().find((w) => w.weekKey === weekKey);
    const normalizedDays = emptyOfficialDays();
    WEEK_DAYS.forEach((d) => {
      const src = days?.[d.key] || {};
      const conductorId = src.conductorId || null;
      const vipId = src.vipId || null;
      normalizedDays[d.key] = {
        conductorId,
        conductorPseudo: conductorId
          ? getPlayerById(conductorId)?.pseudo || src.conductorPseudo || null
          : src.conductorPseudo || null,
        vipId,
        vipPseudo: vipId
          ? getPlayerById(vipId)?.pseudo || src.vipPseudo || null
          : src.vipPseudo || null,
      };
    });
    return {
      id: existing?.id || uid('thw'),
      weekKey,
      weekLabel: weekLabel || existing?.weekLabel || 'Semaine',
      weekStartDate: weekStartDate || existing?.weekStartDate || null,
      weekEndDate: weekEndDate || existing?.weekEndDate || null,
      source: source || existing?.source || 'close',
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      days: normalizedDays,
    };
  }

  async function pushOfficialWeekToSupabase(week) {
    const client = getSupabaseClient();
    if (!client || !week) return { ok: false, reason: 'no-client' };
    const userId = getSessionUserId();
    try {
      const { error: weekError } = await client.from('train_history_weeks').upsert(
        {
          id: week.id,
          week_key: week.weekKey,
          week_label: week.weekLabel,
          week_start_date: week.weekStartDate,
          week_end_date: week.weekEndDate,
          source: week.source === 'init' ? 'init' : week.source === 'correction' ? 'correction' : 'close',
          updated_at: week.updatedAt,
          updated_by: userId,
          created_at: week.createdAt,
        },
        { onConflict: 'id' }
      );
      if (weekError) throw weekError;

      const dayRows = WEEK_DAYS.map((d) => {
        const slot = week.days[d.key] || {};
        return {
          id: `${week.id}_${d.key}`,
          week_id: week.id,
          day_key: d.key,
          day_label: d.label,
          day_date: null,
          conductor_player_id: slot.conductorId,
          conductor_pseudo: slot.conductorPseudo,
          vip_player_id: slot.vipId,
          vip_pseudo: slot.vipPseudo,
        };
      });
      const { error: daysError } = await client
        .from('train_history_days')
        .upsert(dayRows, { onConflict: 'week_id,day_key' });
      if (daysError) throw daysError;
      return { ok: true };
    } catch (error) {
      console.error('Train historique Supabase', error);
      return { ok: false, error };
    }
  }

  async function pullOfficialWeeksFromSupabase() {
    const client = getSupabaseClient();
    if (!client) return false;
    try {
      const { data: weeks, error } = await client
        .from('train_history_weeks')
        .select('*, train_history_days(*)')
        .order('week_start_date', { ascending: true, nullsFirst: false });
      if (error) throw error;
      if (!Array.isArray(weeks) || !weeks.length) return false;
      const mapped = weeks.map((row) => {
        const days = emptyOfficialDays();
        (row.train_history_days || []).forEach((day) => {
          if (!day?.day_key || !days[day.day_key]) return;
          days[day.day_key] = normalizeOfficialDay({
            conductorId: day.conductor_player_id,
            conductorPseudo: day.conductor_pseudo,
            vipId: day.vip_player_id,
            vipPseudo: day.vip_pseudo,
          });
        });
        return normalizeOfficialWeek({
          id: row.id,
          weekKey: row.week_key,
          weekLabel: row.week_label,
          weekStartDate: row.week_start_date,
          weekEndDate: row.week_end_date,
          source: row.source,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          days,
        });
      });
      update((s) => {
        const byKey = new Map();
        (s.officialWeeks || []).forEach((w) => byKey.set(w.weekKey, w));
        mapped.forEach((remote) => {
          const local = byKey.get(remote.weekKey);
          if (!local || String(remote.updatedAt || '') >= String(local.updatedAt || '')) {
            byKey.set(remote.weekKey, remote);
          }
        });
        s.officialWeeks = Array.from(byKey.values()).sort((a, b) => {
          const da = a.weekStartDate || a.createdAt || '';
          const db = b.weekStartDate || b.createdAt || '';
          return db.localeCompare(da);
        });
        return s;
      });
      return true;
    } catch (error) {
      console.error('Train pull historique', error);
      return false;
    }
  }

  function saveOfficialWeekLocal(week) {
    update((s) => {
      if (!Array.isArray(s.officialWeeks)) s.officialWeeks = [];
      const idx = s.officialWeeks.findIndex((w) => w.weekKey === week.weekKey || w.id === week.id);
      if (idx >= 0) s.officialWeeks[idx] = week;
      else s.officialWeeks.unshift(week);
      s.officialWeeks.sort((a, b) => {
        const da = a.weekStartDate || a.createdAt || '';
        const db = b.weekStartDate || b.createdAt || '';
        return db.localeCompare(da);
      });
      return s;
    });
    void pushOfficialWeekToSupabase(week);
    return week;
  }

  function upsertOfficialWeekFromClosedPlan(trainState, plan, meta = {}) {
    const week = getCurrentWeek();
    const weekKey =
      plan.weekId || week?.id || meta.weekKey || `plan_${currentMonthKey()}_${Date.now()}`;
    const days = {};
    WEEK_DAYS.forEach((d) => {
      const slot = plan.days?.[d.key] || {};
      days[d.key] = {
        conductorId: slot.conductorId || null,
        conductorPseudo: getPlayerById(slot.conductorId)?.pseudo || null,
        vipId: slot.vipId || null,
        vipPseudo: getPlayerById(slot.vipId)?.pseudo || null,
      };
    });
    const payload = buildOfficialWeekPayload({
      weekKey,
      weekLabel: week?.label || meta.weekLabel || 'Semaine',
      weekStartDate: week?.startDate || meta.weekStartDate || null,
      weekEndDate: week?.endDate || meta.weekEndDate || null,
      source: 'close',
      days,
    });
    if (!Array.isArray(trainState.officialWeeks)) trainState.officialWeeks = [];
    const idx = trainState.officialWeeks.findIndex(
      (w) => w.weekKey === payload.weekKey || w.id === payload.id
    );
    if (idx >= 0) trainState.officialWeeks[idx] = payload;
    else trainState.officialWeeks.unshift(payload);
    trainState.officialWeeks.sort((a, b) => {
      const da = a.weekStartDate || a.createdAt || '';
      const db = b.weekStartDate || b.createdAt || '';
      return db.localeCompare(da);
    });
    void pushOfficialWeekToSupabase(payload);
    return payload;
  }

  function correctOfficialDay(weekId, dayKey, field, nextPlayerId) {
    if (!canCorrectTrainArchive()) {
      return { ok: false, error: 'Seuls les R4 et R5 peuvent corriger l’historique Train.' };
    }
    if (field !== 'conductorId' && field !== 'vipId') {
      return { ok: false, error: 'Champ invalide.' };
    }
    const nextId = String(nextPlayerId || '').trim();
    if (!nextId) return { ok: false, error: 'Sélectionnez un joueur.' };
    const nextPlayer = getPlayerById(nextId);
    if (!nextPlayer) return { ok: false, error: 'Joueur introuvable.' };

    const weeks = getOfficialWeeks();
    const week = weeks.find((w) => w.id === weekId || w.weekKey === weekId);
    if (!week) return { ok: false, error: 'Semaine historique introuvable.' };
    const slot = week.days?.[dayKey];
    if (!slot) return { ok: false, error: 'Jour introuvable.' };

    const oldId = slot[field] || null;
    if (oldId === nextId) return { ok: false, error: 'Choisissez un joueur différent.' };
    const otherField = field === 'conductorId' ? 'vipId' : 'conductorId';
    if (slot[otherField] && slot[otherField] === nextId) {
      return { ok: false, error: 'Un joueur ne peut pas être Conducteur et VIP le même jour.' };
    }

    const roleLabel = field === 'conductorId' ? 'Conducteur' : 'VIP';

    update((s) => {
      const target = (s.officialWeeks || []).find((w) => w.id === week.id);
      if (!target?.days?.[dayKey]) return s;
      const day = target.days[dayKey];
      day[field] = nextId;
      if (field === 'conductorId') day.conductorPseudo = nextPlayer.pseudo;
      else day.vipPseudo = nextPlayer.pseudo;
      target.updatedAt = new Date().toISOString();
      if (target.source !== 'init') target.source = 'correction';

      // Aligner l’historique plat + compteurs mensuels si la semaine avait été clôturée
      const flat = (s.history || []).find(
        (h) => h && (h.weekId === target.weekKey || h.weekId === target.id) && h.day === dayKey
      );
      if (flat) {
        const monthKey = historyMonthKey(flat) || currentMonthKey();
        const applied = s.appliedPlans?.[target.weekKey];
        const oldDeltas = Array.isArray(applied?.deltas) ? applied.deltas : [];
        flat[field] = nextId;
        if (field === 'conductorId') flat.conductorPseudo = nextPlayer.pseudo;
        else {
          flat.vipPseudo = nextPlayer.pseudo;
          flat.mode = 'Correction';
        }
        flat.correctedAt = new Date().toISOString();
        if (oldDeltas.length) {
          applyDeltas(s, applied.monthKey || monthKey, oldDeltas, 'reverse');
          const weekEntries = (s.history || []).filter(
            (h) => h && (h.weekId === target.weekKey || h.weekId === target.id)
          );
          const newDeltas = deltasFromHistoryEntries(weekEntries);
          applyDeltas(s, applied.monthKey || monthKey, newDeltas, 'apply');
          applied.deltas = newDeltas;
        }
        refreshHistoryCounterLabels(s, monthKey);
      }

      void pushOfficialWeekToSupabase(target);
      return s;
    });

    return { ok: true, roleLabel, oldId, nextId };
  }

  function getArchiveCorrectionCandidates(entry, field) {
    if (!entry || (field !== 'conductorId' && field !== 'vipId')) return [];
    const otherId = field === 'conductorId' ? entry.vipId : entry.conductorId;
    const currentId = entry[field] || null;
    return getActivePlayers().filter((p) => p.id !== otherId && p.id !== currentId);
  }

  /**
   * Correction administrative d’une journée archivée (pas un nouveau tirage).
   * Met à jour l’historique, les compteurs mensuels et le snapshot weekArchives.
   */
  function correctArchivedHistoryRole(historyId, field, nextPlayerId) {
    if (!canCorrectTrainArchive()) {
      return { ok: false, error: 'Seuls les R4 et R5 peuvent corriger l’historique Train.' };
    }
    if (field !== 'conductorId' && field !== 'vipId') {
      return { ok: false, error: 'Champ invalide.' };
    }
    const nextId = String(nextPlayerId || '').trim();
    if (!nextId) return { ok: false, error: 'Sélectionnez un joueur.' };

    const trainState = getState();
    const entry = (trainState.history || []).find((h) => h && h.id === historyId);
    if (!entry) return { ok: false, error: 'Entrée d’historique introuvable.' };

    const oldId = entry[field] || null;
    if (oldId === nextId) return { ok: false, error: 'Choisissez un joueur différent.' };

    const otherField = field === 'conductorId' ? 'vipId' : 'conductorId';
    if (entry[otherField] && entry[otherField] === nextId) {
      return {
        ok: false,
        error: 'Un joueur ne peut pas être Conducteur et VIP le même jour.',
      };
    }

    if (field === 'conductorId' && entry.day && entry.day !== 'dimanche') {
      const conflict = (trainState.history || []).some(
        (h) =>
          h &&
          h.weekId === entry.weekId &&
          h.id !== entry.id &&
          h.day &&
          h.day !== 'dimanche' &&
          h.conductorId === nextId
      );
      if (conflict) {
        return {
          ok: false,
          error: 'Ce joueur est déjà Conducteur un autre jour de cette semaine archivée.',
        };
      }
    }

    if (field === 'vipId') {
      const vipConflict = (trainState.history || []).some(
        (h) =>
          h &&
          h.weekId === entry.weekId &&
          h.id !== entry.id &&
          h.vipId === nextId
      );
      if (vipConflict) {
        return {
          ok: false,
          error: 'Ce joueur est déjà VIP un autre jour de cette semaine archivée.',
        };
      }
    }

    const nextPlayer = getPlayerById(nextId);
    if (!nextPlayer) return { ok: false, error: 'Joueur introuvable.' };

    const monthKey = historyMonthKey(entry) || currentMonthKey();
    const countField = field === 'conductorId' ? 'conductor' : 'vip';
    const roleLabel = field === 'conductorId' ? 'Conducteur' : 'VIP';

    update((s) => {
      const target = (s.history || []).find((h) => h && h.id === historyId);
      if (!target) return s;

      const weekId = target.weekId;
      const dayKey = target.day;
      const applied = weekId && s.appliedPlans ? s.appliedPlans[weekId] : null;
      const oldDeltas = Array.isArray(applied?.deltas) ? applied.deltas : [];
      const hadCounts = oldDeltas.length > 0;

      target[field] = nextId;
      if (field === 'conductorId') {
        target.conductorPseudo = nextPlayer.pseudo;
      } else {
        target.vipPseudo = nextPlayer.pseudo;
      }
      target.mode = 'Correction';
      target.correctedAt = new Date().toISOString();
      target.correctedField = field;

      const archivePatch =
        field === 'conductorId'
          ? {
              conductorId: nextId,
              conductorPseudo: nextPlayer.pseudo,
            }
          : {
              vipId: nextId,
              vipPseudo: nextPlayer.pseudo,
              vipMode: 'manuel',
            };
      syncWeekArchiveDay(s, weekId, dayKey, archivePatch);

      if (hadCounts) {
        applyDeltas(s, applied.monthKey || monthKey, oldDeltas, 'reverse');
        const newDeltas = deltasFromHistoryEntries(historyEntriesForWeek(s, weekId));
        applyDeltas(s, applied.monthKey || monthKey, newDeltas, 'apply');
        applied.deltas = newDeltas;
        applied.correctedAt = new Date().toISOString();
      } else {
        // Semaine archivée sans compteurs appliqués : ajuster uniquement le rôle corrigé
        if (oldId) adjustCount(s, monthKey, oldId, countField, -1);
        adjustCount(s, monthKey, nextId, countField, 1);
        if (applied) {
          applied.deltas = deltasFromHistoryEntries(historyEntriesForWeek(s, weekId));
          applied.correctedAt = new Date().toISOString();
        }
      }

      refreshHistoryCounterLabels(s, monthKey);
      if (field === 'conductorId') {
        const counts = readCountsFrom(s, monthKey, nextId);
        syncWeekArchiveDay(s, weekId, dayKey, {
          conductorCounters: counts,
        });
      } else {
        const counts = readCountsFrom(s, monthKey, nextId);
        syncWeekArchiveDay(s, weekId, dayKey, {
          vipCounters: counts,
        });
      }
      return s;
    });

    return {
      ok: true,
      roleLabel,
      oldId,
      nextId,
      monthKey,
    };
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
    // Tirage équitable : uniquement parmi les éligibles au minimum historique VIP
    return pickFairByHistorical(eligible, 'vip');
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
        upsertOfficialWeekFromClosedPlan(s, s.weeklyPlan, {
          weekKey: weekId,
          weekLabel,
        });
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

      // Historique officiel : upsert (pas de doublon pour la même semaine)
      upsertOfficialWeekFromClosedPlan(s, s.weeklyPlan, {
        weekKey: weekId,
        weekLabel,
      });
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
    els.historySince = document.getElementById('trainHistorySince');
    els.equityBody = document.getElementById('trainEquityBody');
    els.equitySort = document.getElementById('trainEquitySort');
    els.settingsHistoryBlock = document.getElementById('settingsTrainHistoryBlock');
    els.settingsHistoryTitle = document.getElementById('settingsTrainHistoryTitle');
    els.settingsHistoryHint = document.getElementById('settingsTrainHistoryHint');
    els.settingsHistoryNote = document.getElementById('settingsTrainHistoryNote');
    els.historySourceWeek = document.getElementById('trainHistorySourceWeek');
    els.initLabel = document.getElementById('trainInitWeekLabel');
    els.initStart = document.getElementById('trainInitWeekStart');
    els.initEnd = document.getElementById('trainInitWeekEnd');
    els.initDays = document.getElementById('trainInitDays');
    els.btnSaveHistoryWeek = document.getElementById('trainSaveHistoryWeek');
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
    if (!els.categoriesList) return;
    const cats = getState().categories;
    const canManage = canCorrectTrainArchive();
    if (els.btnAddCategory) {
      els.btnAddCategory.disabled = !canManage;
      els.btnAddCategory.title = canManage
        ? 'Ajouter une catégorie'
        : 'Réservé aux R4 et R5';
    }
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
                ${
                  canManage
                    ? `<button type="button" class="btn btn-ghost btn-sm" data-train-action="edit-cat" data-id="${cat.id}">Modifier</button>
                <button type="button" class="btn btn-danger btn-sm" data-train-action="delete-cat" data-id="${cat.id}">Supprimer</button>`
                    : ''
                }
              </div>
            </div>
            <h4 class="stack-item-title">${escapeHtml(cat.name)}</h4>
          </article>
        `
      )
      .join('');
  }

  function renderConductors() {
    if (!els.conductorsList) return;
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

    replaceContext = { source: 'week', dayKey, field };
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
        `<option value="${p.id}">${escapeHtml(formatPlayerWithHistorical(p))} · mois ${getPlayerMonthCounts(p.id).conductor}/${getPlayerMonthCounts(p.id).vip}</option>`
      );
    });
    els.replaceSelect.innerHTML = opts.join('');
    if (!eligible.filter((p) => p.id !== currentId).length) {
      AppUI.toast(`Aucun ${roleLabel.toLowerCase()} éligible disponible.`);
      return;
    }
    if (typeof els.replaceModal.showModal === 'function') els.replaceModal.showModal();
  }

  function openOfficialReplaceModal(weekId, dayKey, field) {
    if (!canCorrectTrainArchive()) {
      AppUI.toast('Seuls les R4 et R5 peuvent corriger l’historique Train.');
      return;
    }
    if (!els.replaceModal || !els.replaceSelect) return;
    const week = getOfficialWeeks().find((w) => w.id === weekId || w.weekKey === weekId);
    if (!week) {
      AppUI.toast('Semaine historique introuvable.');
      return;
    }
    const slot = week.days?.[dayKey] || {};
    const roleLabel = field === 'conductorId' ? 'Conducteur' : 'VIP';
    const currentId = slot[field] || null;
    const otherId = field === 'conductorId' ? slot.vipId : slot.conductorId;
    const candidates = getActivePlayers().filter((p) => p.id !== otherId && p.id !== currentId);
    const day = WEEK_DAYS.find((d) => d.key === dayKey);

    replaceContext = { source: 'official', weekId: week.id, dayKey, field };
    if (els.replaceTitle) {
      els.replaceTitle.textContent = `Corriger — ${roleLabel} (${day?.label || dayKey})`;
    }
    if (els.replaceHint) {
      els.replaceHint.textContent = currentId
        ? `Historique officiel · ${week.weekLabel} · Actuel : ${playerName(currentId)}. Enregistrez qui a réellement pris la place.`
        : `Historique officiel · ${week.weekLabel}. Choisissez le ${roleLabel.toLowerCase()} réel.`;
    }
    const opts = ['<option value="">— Choisir —</option>'];
    candidates.forEach((p) => {
      opts.push(`<option value="${p.id}">${escapeHtml(formatPlayerWithHistorical(p))}</option>`);
    });
    els.replaceSelect.innerHTML = opts.join('');
    if (!candidates.length) {
      AppUI.toast('Aucun joueur disponible pour cette correction.');
      return;
    }
    if (typeof els.replaceModal.showModal === 'function') els.replaceModal.showModal();
  }

  function openHistoryReplaceModal(historyId, field) {
    if (!canCorrectTrainArchive()) {
      AppUI.toast('Seuls les R4 et R5 peuvent corriger l’historique Train.');
      return;
    }
    if (!els.replaceModal || !els.replaceSelect) return;
    const entry = getState().history.find((h) => h && h.id === historyId);
    if (!entry) {
      AppUI.toast('Entrée d’historique introuvable.');
      return;
    }
    const roleLabel = field === 'conductorId' ? 'Conducteur' : 'VIP';
    const currentId = entry[field] || null;
    const candidates = getArchiveCorrectionCandidates(entry, field);
    const monthKey = historyMonthKey(entry) || currentMonthKey();

    replaceContext = { source: 'history', historyId, field };
    if (els.replaceTitle) {
      els.replaceTitle.textContent = `Corriger — ${roleLabel} (${entry.dayLabel || entry.day || 'jour'})`;
    }
    if (els.replaceHint) {
      els.replaceHint.textContent = currentId
        ? `Archive · ${entry.weekLabel || 'Semaine'} · Actuel : ${playerName(currentId)}. Choisissez qui a réellement pris la place (pas de nouveau tirage).`
        : `Archive · ${entry.weekLabel || 'Semaine'}. Choisissez le ${roleLabel.toLowerCase()} réel.`;
    }

    const opts = ['<option value="">— Choisir —</option>'];
    candidates.forEach((p) => {
      opts.push(
        `<option value="${p.id}">${escapeHtml(formatPlayerWithHistorical(p))}</option>`
      );
    });
    els.replaceSelect.innerHTML = opts.join('');
    if (!candidates.length) {
      AppUI.toast('Aucun joueur disponible pour cette correction.');
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
    const nextId = (els.replaceSelect?.value || '').trim();
    if (!nextId) {
      AppUI.toast('Sélectionnez un joueur.');
      return;
    }

    if (replaceContext.source === 'official') {
      const { weekId, dayKey, field } = replaceContext;
      const week = getOfficialWeeks().find((w) => w.id === weekId);
      const roleLabel = field === 'conductorId' ? 'Conducteur' : 'VIP';
      const day = WEEK_DAYS.find((d) => d.key === dayKey);
      const ok = await AppUI.confirm({
        title: `Corriger le ${roleLabel} historique`,
        message: `${week?.weekLabel || 'Semaine'} · ${day?.label || dayKey} — ${roleLabel} : ${playerName(nextId)} ?\n\nCorrection administrative uniquement.`,
        confirmLabel: 'Valider la correction',
      });
      if (!ok) return;
      const result = correctOfficialDay(weekId, dayKey, field, nextId);
      closeReplaceModal();
      if (!result.ok) {
        AppUI.toast(result.error || 'Correction impossible.');
        return;
      }
      AppUI.toast(`${result.roleLabel} historique corrigé.`);
      return;
    }

    if (replaceContext.source === 'history') {
      const { historyId, field } = replaceContext;
      const entry = getState().history.find((h) => h && h.id === historyId);
      const roleLabel = field === 'conductorId' ? 'Conducteur' : 'VIP';
      const ok = await AppUI.confirm({
        title: `Corriger le ${roleLabel} archivé`,
        message: `${entry?.weekLabel || 'Semaine'} · ${entry?.dayLabel || entry?.day || ''} — ${roleLabel} : ${playerName(nextId)} ?\n\nCorrection de l’historique réel uniquement. Les autres jours restent inchangés.`,
        confirmLabel: 'Valider la correction',
      });
      if (!ok) return;
      const result = correctArchivedHistoryRole(historyId, field, nextId);
      closeReplaceModal();
      if (!result.ok) {
        AppUI.toast(result.error || 'Correction impossible.');
        return;
      }
      AppUI.toast(`${result.roleLabel} archivé corrigé — compteurs mis à jour.`);
      return;
    }

    const { dayKey, field } = replaceContext;
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
        const monthCounts = getPlayerMonthCounts(c.playerId);
        const hist = getHistoricalCounts(c.playerId);
        const already = taken.has(c.playerId);
        const disabled = locked || already;
        return `
          <article class="train-candidate-card">
            <div>
              <h4 class="stack-item-title">${escapeHtml(c.player.pseudo)}</h4>
              <div class="player-meta" style="margin-top:0.35rem">
                <span class="badge badge-saison">${escapeHtml(c.categoryName)}</span>
                <span class="chip muted">Mérite — choix manuel</span>
              </div>
              <p class="panel-subtitle" style="margin:0.4rem 0 0">
                Conducteur depuis le début : <strong>${hist.conductor}</strong>
                · VIP depuis le début : <strong>${hist.vip}</strong>
              </p>
              <p class="panel-subtitle" style="margin:0.2rem 0 0">
                Ce mois — Conducteur ${monthCounts.conductor} | VIP ${monthCounts.vip}
              </p>
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

  function renderOfficialRoleLine(week, dayKey, field, canEdit) {
    const slot = week.days?.[dayKey] || {};
    const isConductor = field === 'conductorId';
    const playerId = isConductor ? slot.conductorId : slot.vipId;
    const fallback = isConductor ? slot.conductorPseudo || '—' : slot.vipPseudo || '—';
    const name = playerId
      ? ROSModels.getPlayerDisplayName(getAllianceState(), playerId, fallback)
      : fallback;
    const roleLabel = isConductor ? 'Conducteur' : 'VIP';
    const btn = canEdit
      ? `<button type="button" class="btn btn-ghost btn-sm train-history-edit-btn" data-train-action="replace-official-role" data-week-id="${escapeHtml(week.id)}" data-day="${dayKey}" data-field="${field}">Modifier</button>`
      : '';
    return `
      <div class="train-history-role">
        <span>${roleLabel} : <strong>${escapeHtml(name)}</strong></span>
        ${btn}
      </div>
    `;
  }

  function getEquityRows() {
    const alliancePlayers = getAllianceState().players || [];
    const rows = alliancePlayers
      .filter((p) => p && (p.status === 'Actif' || p.status === 'Parti'))
      .map((p) => {
        const hist = getHistoricalCounts(p.id);
        return {
          id: p.id,
          pseudo: p.pseudo,
          status: p.status,
          conductor: hist.conductor,
          vip: hist.vip,
        };
      });
    // Inclure aussi les IDs présents dans l’historique mais absents de la liste joueurs
    const seen = new Set(rows.map((r) => r.id));
    getOfficialWeeks().forEach((week) => {
      WEEK_DAYS.forEach((d) => {
        const slot = week.days?.[d.key];
        if (!slot) return;
        [slot.conductorId, slot.vipId].forEach((id) => {
          if (!id || seen.has(id)) return;
          seen.add(id);
          const hist = getHistoricalCounts(id);
          rows.push({
            id,
            pseudo: slot.conductorId === id ? slot.conductorPseudo : slot.vipPseudo || id,
            status: 'Archivé',
            conductor: hist.conductor,
            vip: hist.vip,
          });
        });
      });
    });
    rows.sort((a, b) => {
      if (equitySort === 'conductor-asc') return a.conductor - b.conductor || a.pseudo.localeCompare(b.pseudo, 'fr');
      if (equitySort === 'conductor-desc') return b.conductor - a.conductor || a.pseudo.localeCompare(b.pseudo, 'fr');
      if (equitySort === 'vip-asc') return a.vip - b.vip || a.pseudo.localeCompare(b.pseudo, 'fr');
      if (equitySort === 'vip-desc') return b.vip - a.vip || a.pseudo.localeCompare(b.pseudo, 'fr');
      return a.pseudo.localeCompare(b.pseudo, 'fr', { sensitivity: 'base' });
    });
    return rows;
  }

  function renderEquityTable() {
    if (!els.equityBody) return;
    if (els.equitySort && els.equitySort.value !== equitySort) {
      els.equitySort.value = equitySort;
    }
    // Tous les actifs (y compris 0) + anciens joueurs ayant des occurrences
    const finalRows = getEquityRows().filter(
      (r) => r.status === 'Actif' || r.conductor > 0 || r.vip > 0
    );
    els.equityBody.innerHTML = finalRows
      .map(
        (r) => `
        <tr>
          <td>${escapeHtml(r.pseudo)}${r.status !== 'Actif' ? ` <span class="chip muted">${escapeHtml(r.status)}</span>` : ''}</td>
          <td>${r.conductor}</td>
          <td>${r.vip}</td>
        </tr>
      `
      )
      .join('');
  }

  function renderHistory() {
    if (els.historySince) {
      const since = getHistoryAvailableSinceLabel();
      els.historySince.textContent = since
        ? `Historique disponible depuis le ${since}`
        : 'Aucun historique officiel pour le moment.';
    }
    if (!els.historyBody) return;
    const weeks = getOfficialWeeks();
    const canEdit = canCorrectTrainArchive();

    if (!weeks.length) {
      els.historyBody.innerHTML = '';
      if (els.historyEmpty) {
        els.historyEmpty.classList.remove('hidden');
        els.historyEmpty.textContent =
          'Aucun historique Train officiel. Initialisez la semaine dernière ou clôturez une semaine.';
      }
      renderEquityTable();
      return;
    }
    if (els.historyEmpty) els.historyEmpty.classList.add('hidden');

    els.historyBody.innerHTML = weeks
      .map((week) => {
        const daysHtml = WEEK_DAYS.map((d) => {
          const slot = week.days?.[d.key];
          if (!slot?.conductorId && !slot?.vipId) return '';
          return `
            <article class="train-official-day">
              <strong>${escapeHtml(d.label)}</strong>
              ${renderOfficialRoleLine(week, d.key, 'conductorId', canEdit)}
              ${renderOfficialRoleLine(week, d.key, 'vipId', canEdit)}
            </article>
          `;
        }).join('');
        return `
          <article class="train-official-week">
            <header class="train-official-week-header">
              <div>
                <strong>${escapeHtml(week.weekLabel)}</strong>
                <div class="panel-subtitle">
                  ${escapeHtml(week.weekStartDate || '—')} → ${escapeHtml(week.weekEndDate || '—')}
                  · <span class="chip muted">${escapeHtml(week.source === 'init' ? 'Initialisation' : week.source === 'correction' ? 'Corrigée' : 'Clôturée')}</span>
                </div>
              </div>
            </header>
            <div class="train-official-days">${daysHtml || '<p class="panel-subtitle">Aucune affectation</p>'}</div>
          </article>
        `;
      })
      .join('');

    renderEquityTable();
  }

  function canManageTrainHistorySettings() {
    // Paramètres → Train : réservé R5 (pas seulement masquage UI)
    if (global.ROSProfiles && typeof ROSProfiles.isActiveR5 === 'function') {
      return Boolean(ROSProfiles.isActiveR5());
    }
    return isR5();
  }

  function collectHistoryWeekSources() {
    const sources = [];
    const plan = getWeeklyPlan();
    const currentWeek = getCurrentWeek();
    sources.push({
      id: 'current',
      label: `Planning courant — ${currentWeek?.label || plan.weekId || 'semaine en cours'}`,
      weekKey: plan.weekId || currentWeek?.id || `current_${currentMonthKey()}`,
      weekLabel: currentWeek?.label || 'Planning courant',
      weekStartDate: currentWeek?.startDate || null,
      weekEndDate: currentWeek?.endDate || null,
      days: WEEK_DAYS.reduce((acc, d) => {
        const slot = plan.days?.[d.key] || {};
        acc[d.key] = {
          conductorId: slot.conductorId || null,
          vipId: slot.vipId || null,
        };
        return acc;
      }, {}),
    });

    (getState().weekArchives || []).forEach((arch) => {
      if (!arch?.id) return;
      const days = {};
      WEEK_DAYS.forEach((d) => {
        const slot = arch.days?.[d.key] || {};
        days[d.key] = {
          conductorId: slot.conductorId || null,
          vipId: slot.vipId || null,
        };
      });
      sources.push({
        id: `archive:${arch.id}`,
        label: `Archive — ${arch.weekLabel || arch.weekId || arch.id}`,
        weekKey: arch.weekId || `archive_${arch.id}`,
        weekLabel: arch.weekLabel || 'Semaine archivée',
        weekStartDate: arch.weekDate?.split?.('→')?.[0]?.trim?.() || arch.monthKey || null,
        weekEndDate: null,
        days,
      });
    });

    getOfficialWeeks().forEach((week) => {
      sources.push({
        id: `official:${week.id}`,
        label: `Historique — ${week.weekLabel}`,
        weekKey: week.weekKey,
        weekLabel: week.weekLabel,
        weekStartDate: week.weekStartDate,
        weekEndDate: week.weekEndDate,
        days: WEEK_DAYS.reduce((acc, d) => {
          const slot = week.days?.[d.key] || {};
          acc[d.key] = {
            conductorId: slot.conductorId || null,
            vipId: slot.vipId || null,
          };
          return acc;
        }, {}),
        officialId: week.id,
      });
    });

    sources.push({
      id: 'blank',
      label: 'Saisie manuelle (vide)',
      weekKey: `init_${new Date().toISOString().slice(0, 10)}`,
      weekLabel: 'Semaine précédente',
      weekStartDate: null,
      weekEndDate: null,
      days: WEEK_DAYS.reduce((acc, d) => {
        acc[d.key] = { conductorId: null, vipId: null };
        return acc;
      }, {}),
    });

    return sources;
  }

  function buildHistoryPlayerOptions(selectedId) {
    const opts = ['<option value="">—</option>'];
    getActivePlayers().forEach((p) => {
      const selected = p.id === selectedId ? ' selected' : '';
      opts.push(
        `<option value="${p.id}"${selected}>${escapeHtml(formatPlayerWithHistorical(p))}</option>`
      );
    });
    if (selectedId && !getPlayerById(selectedId)) {
      opts.push(
        `<option value="${escapeHtml(selectedId)}" selected>${escapeHtml(selectedId)} (inconnu)</option>`
      );
    }
    return opts.join('');
  }

  function fillSettingsHistoryDays(daysMap) {
    if (!els.initDays) return;
    els.initDays.innerHTML = WEEK_DAYS.map((d) => {
      const slot = daysMap?.[d.key] || {};
      return `
        <div class="train-init-day" data-init-day="${d.key}">
          <strong>${escapeHtml(d.label)}</strong>
          <label class="field">
            <span>Conducteur</span>
            <select class="input" data-init-field="conductorId">
              ${buildHistoryPlayerOptions(slot.conductorId || null)}
            </select>
          </label>
          <label class="field">
            <span>VIP</span>
            <select class="input" data-init-field="vipId">
              ${buildHistoryPlayerOptions(slot.vipId || null)}
            </select>
          </label>
        </div>
      `;
    }).join('');
  }

  function applyHistorySourceToForm(sourceId) {
    const sources = collectHistoryWeekSources();
    const source = sources.find((s) => s.id === sourceId) || sources[0];
    if (!source) return;
    if (els.historySourceWeek) els.historySourceWeek.value = source.id;
    if (els.initLabel) els.initLabel.value = source.weekLabel || '';
    if (els.initStart) els.initStart.value = source.weekStartDate || '';
    if (els.initEnd) els.initEnd.value = source.weekEndDate || '';
    fillSettingsHistoryDays(source.days);
    if (els.settingsHistoryNote) {
      els.settingsHistoryNote.textContent = source.id.startsWith('official:')
        ? 'Semaine déjà dans l’historique — les modifications mettront à jour l’enregistrement (pas de doublon).'
        : 'Les valeurs affichées sont des propositions. Corrigez-les avant enregistrement si la réalité était différente.';
    }
  }

  function renderSettingsHistoryAdmin() {
    if (!els.settingsHistoryBlock) return;
    const allowed = canManageTrainHistorySettings();
    els.settingsHistoryBlock.classList.toggle('hidden', !allowed);
    if (!allowed) return;

    const hasOfficial = getOfficialWeeks().length > 0;
    if (els.settingsHistoryTitle) {
      els.settingsHistoryTitle.textContent = hasOfficial
        ? 'Gérer l’historique Train'
        : 'Initialiser l’historique Train';
    }
    if (els.settingsHistoryHint) {
      els.settingsHistoryHint.textContent = hasOfficial
        ? 'Corrigez une semaine déjà enregistrée ou ajoutez une autre semaine connue. Les compteurs historiques se recalculent automatiquement.'
        : 'Aucun historique antérieur n’est disponible. Choisissez une semaine connue, corrigez si besoin, puis enregistrez-la comme point de départ.';
    }

    const sources = collectHistoryWeekSources();
    const previous = els.historySourceWeek?.value || '';
    if (els.historySourceWeek) {
      els.historySourceWeek.innerHTML = sources
        .map(
          (s) =>
            `<option value="${escapeHtml(s.id)}">${escapeHtml(s.label)}</option>`
        )
        .join('');
      const keep = sources.some((s) => s.id === previous)
        ? previous
        : sources.find((s) => s.id.startsWith('official:'))?.id || sources[0]?.id;
      if (keep) els.historySourceWeek.value = keep;
      applyHistorySourceToForm(els.historySourceWeek.value);
    }
  }

  function readSettingsHistoryFormDays() {
    const days = {};
    WEEK_DAYS.forEach((d) => {
      const row = els.initDays?.querySelector(`[data-init-day="${d.key}"]`);
      const conductorId = (row?.querySelector('[data-init-field="conductorId"]')?.value || '').trim() || null;
      const vipId = (row?.querySelector('[data-init-field="vipId"]')?.value || '').trim() || null;
      days[d.key] = { conductorId, vipId };
    });
    return days;
  }

  function formatHistoryRecap(days, label) {
    const lines = [`Semaine : ${label}`, ''];
    WEEK_DAYS.forEach((d) => {
      const slot = days[d.key] || {};
      if (!slot.conductorId && !slot.vipId) return;
      lines.push(
        `${d.label} — Conducteur : ${playerName(slot.conductorId)} · VIP : ${playerName(slot.vipId)}`
      );
    });
    return lines.join('\n');
  }

  async function submitSettingsHistoryWeek() {
    if (!canManageTrainHistorySettings()) {
      AppUI.toast('Seul le R5 peut gérer l’historique Train depuis Paramètres.');
      return;
    }
    const sources = collectHistoryWeekSources();
    const source = sources.find((s) => s.id === els.historySourceWeek?.value) || sources[0];
    const label = (els.initLabel?.value || '').trim() || source?.weekLabel || 'Semaine';
    const start = els.initStart?.value || null;
    const end = els.initEnd?.value || null;
    const days = readSettingsHistoryFormDays();
    const hasAny = WEEK_DAYS.some((d) => days[d.key].conductorId || days[d.key].vipId);
    if (!hasAny) {
      AppUI.toast('Renseignez au moins un Conducteur ou VIP.');
      return;
    }

    let weekKey = source?.weekKey || `init_${start || end || new Date().toISOString().slice(0, 10)}`;
    if (source?.id === 'blank') {
      weekKey = `init_${start || end || new Date().toISOString().slice(0, 10)}`;
    }

    const recap = formatHistoryRecap(days, label);
    const ok = await AppUI.confirm({
      title: 'Enregistrer cette semaine dans l’historique',
      message: `${recap}\n\nCes valeurs corrigées seront la réalité historique (mise à jour sans doublon si la semaine existe déjà).`,
      confirmLabel: 'Enregistrer dans l’historique',
    });
    if (!ok) return;

    const existing = getOfficialWeeks().find(
      (w) => w.weekKey === weekKey || (source?.officialId && w.id === source.officialId)
    );
    const payload = buildOfficialWeekPayload({
      weekKey: existing?.weekKey || weekKey,
      weekLabel: label,
      weekStartDate: start,
      weekEndDate: end,
      source: existing ? 'correction' : 'init',
      days,
    });
    if (existing) payload.id = existing.id;
    saveOfficialWeekLocal(payload);
    AppUI.toast('Semaine enregistrée dans l’historique officiel.');
    renderSettingsHistoryAdmin();
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
    renderSettingsHistoryAdmin();
    refreshActionButtons();
  }

  /* ---------- Actions ---------- */

  async function addCategory() {
    if (!canCorrectTrainArchive()) {
      AppUI.toast('Seuls les R4 et R5 peuvent gérer les catégories Train.');
      return;
    }
    const name = window.prompt('Nom de la nouvelle catégorie :', 'Nouvelle catégorie');
    if (!name || !name.trim()) return;

    update((s) => {
      s.categories.push(makeCategory(name.trim(), 'saison'));
      return s;
    });
    AppUI.toast('Catégorie créée.');
  }

  async function editCategory(id) {
    if (!canCorrectTrainArchive()) {
      AppUI.toast('Seuls les R4 et R5 peuvent gérer les catégories Train.');
      return;
    }
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
    if (!canCorrectTrainArchive()) {
      AppUI.toast('Seuls les R4 et R5 peuvent gérer les catégories Train.');
      return;
    }
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

  function onCategoriesClick(event) {
    const btn = event.target.closest('[data-train-action]');
    if (!btn) return;
    const { trainAction, id } = btn.dataset;
    if (trainAction === 'edit-cat') editCategory(id);
    if (trainAction === 'delete-cat') deleteCategory(id);
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
    if (trainAction === 'replace-history-role') {
      openHistoryReplaceModal(btn.dataset.historyId, btn.dataset.field);
    }
    if (trainAction === 'replace-official-role') {
      openOfficialReplaceModal(btn.dataset.weekId, btn.dataset.day, btn.dataset.field);
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
    if (els.categoriesList) {
      els.categoriesList.addEventListener('click', onCategoriesClick);
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
    if (els.equitySort) {
      els.equitySort.addEventListener('change', () => {
        equitySort = els.equitySort.value || 'alpha';
        renderEquityTable();
      });
    }
    if (els.historySourceWeek) {
      els.historySourceWeek.addEventListener('change', () => {
        applyHistorySourceToForm(els.historySourceWeek.value);
      });
    }
    if (els.btnSaveHistoryWeek) {
      els.btnSaveHistoryWeek.addEventListener('click', () => {
        void submitSettingsHistoryWeek();
      });
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

    // Aligner le cache local avec les tables Supabase si disponibles
    void pullOfficialWeeksFromSupabase();
  }

  global.TrainModule = {
    init,
    render,
    hydrateFromStorage,
    STORAGE_KEY,
    getPlayerMonthCounts,
    getHistoricalCounts,
    formatPlayerCounters,
    formatCountersShort,
    formatPlayerWithHistorical,
    currentMonthKey,
    migratePlayerIdentity,
    getVipDrawExclusionStats,
    isEligibleForWeekVip,
    isEligibleForWeekConductor,
    correctArchivedHistoryRole,
    correctOfficialDay,
    canCorrectTrainArchive,
    getVipIdsThisMonth,
    pickFairByHistorical,
    getOfficialWeeks,
    saveOfficialWeekLocal,
    buildOfficialWeekPayload,
    pullOfficialWeeksFromSupabase,
    renderSettingsHistoryAdmin,
    canManageTrainHistorySettings,
  };
})(window);
