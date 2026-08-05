/**
 * Modèles, constantes et calculs métier — ROS6 Command Center
 */
(function (global) {
  const DAYS = [
    { key: 'lundi', label: 'Lundi', short: 'Lun' },
    { key: 'mardi', label: 'Mardi', short: 'Mar' },
    { key: 'mercredi', label: 'Mercredi', short: 'Mer' },
    { key: 'jeudi', label: 'Jeudi', short: 'Jeu' },
    { key: 'vendredi', label: 'Vendredi', short: 'Ven' },
  ];

  /** Options legacy (archives / compat affichage). Préférer getDayOptions(state). */
  const DAY_OPTIONS = [
    { value: 0, label: 'Plus de 7,2 M · 0 pt' },
    { value: 5, label: '3,7 à 7,2 M · 5 pts' },
    { value: 10, label: '0 à 3,6 M · 10 pts' },
  ];

  const PLAYER_ROLES = ['R5', 'R4', 'Membre'];
  const PLAYER_STATUSES = ['Actif', 'Parti'];
  const APP_ROLES = ['R5', 'R4'];
  const DONATION_PENALTY = 5;
  const DATA_VERSION = 1;
  const VS_BRACKETS = ['ok', 'mid', 'low'];
  const VS_MODES = ['eco', 'afond'];

  function createDefaultVsSettings() {
    return {
      mode: 'eco',
      afond: {
        dailyGoal: 7200000,
        midMin: 3600000,
        midPoints: 5,
        lowPoints: 12,
        donationPenalty: 5,
        redFrom: 36,
      },
      eco: {
        dailyGoal: 3600000,
        underPoints: 10,
        donationPenalty: 5,
        redFrom: 30,
      },
    };
  }

  function toPositiveInt(value, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return fallback;
    return Math.round(n);
  }

  function normalizeVsSettings(raw) {
    const defaults = createDefaultVsSettings();
    const src = raw && typeof raw === 'object' ? raw : {};
    const afondSrc = src.afond && typeof src.afond === 'object' ? src.afond : {};
    const ecoSrc = src.eco && typeof src.eco === 'object' ? src.eco : {};
    const mode = VS_MODES.includes(src.mode) ? src.mode : defaults.mode;

    return {
      mode,
      afond: {
        dailyGoal: toPositiveInt(afondSrc.dailyGoal, defaults.afond.dailyGoal),
        midMin: toPositiveInt(afondSrc.midMin, defaults.afond.midMin),
        midPoints: toPositiveInt(afondSrc.midPoints, defaults.afond.midPoints),
        lowPoints: toPositiveInt(afondSrc.lowPoints, defaults.afond.lowPoints),
        donationPenalty: toPositiveInt(afondSrc.donationPenalty, defaults.afond.donationPenalty),
        redFrom: toPositiveInt(afondSrc.redFrom, defaults.afond.redFrom),
      },
      eco: {
        dailyGoal: toPositiveInt(ecoSrc.dailyGoal, defaults.eco.dailyGoal),
        underPoints: toPositiveInt(ecoSrc.underPoints, defaults.eco.underPoints),
        donationPenalty: toPositiveInt(ecoSrc.donationPenalty, defaults.eco.donationPenalty),
        redFrom: toPositiveInt(ecoSrc.redFrom, defaults.eco.redFrom),
      },
    };
  }

  function getVsSettings(stateOrSettings) {
    if (stateOrSettings?.afond && stateOrSettings?.eco) {
      return normalizeVsSettings(stateOrSettings);
    }
    if (stateOrSettings?.vsSettings) {
      return normalizeVsSettings(stateOrSettings.vsSettings);
    }
    if (global.ROSStorage && typeof global.ROSStorage.getState === 'function') {
      try {
        return normalizeVsSettings(global.ROSStorage.getState()?.vsSettings);
      } catch (_err) {
        /* ignore */
      }
    }
    return createDefaultVsSettings();
  }

  function getActiveVsConfig(stateOrSettings) {
    const settings = getVsSettings(stateOrSettings);
    return settings.mode === 'afond' ? settings.afond : settings.eco;
  }

  function formatVsMillions(value) {
    const n = Number(value) || 0;
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }

  function formatVsMillionsShort(value) {
    const n = Number(value) || 0;
    if (n >= 1000000) {
      const millions = n / 1000000;
      const text = Number.isInteger(millions)
        ? String(millions)
        : String(Math.round(millions * 10) / 10).replace('.', ',');
      return `${text} M`;
    }
    return formatVsMillions(n);
  }

  function inferDayBracket(points) {
    const p = Number(points) || 0;
    if (p <= 0) return 'ok';
    if (p === 5) return 'mid';
    return 'low';
  }

  function pointsForBracket(bracket, stateOrSettings) {
    const settings = getVsSettings(stateOrSettings);
    const key = VS_BRACKETS.includes(bracket) ? bracket : 'ok';
    if (settings.mode === 'afond') {
      if (key === 'ok') return 0;
      if (key === 'mid') return settings.afond.midPoints;
      return settings.afond.lowPoints;
    }
    if (key === 'low') return settings.eco.underPoints;
    return 0;
  }

  function getDayOptions(stateOrSettings) {
    const settings = getVsSettings(stateOrSettings);
    if (settings.mode === 'afond') {
      const goal = formatVsMillionsShort(settings.afond.dailyGoal);
      const mid = formatVsMillionsShort(settings.afond.midMin);
      const midHigh = formatVsMillionsShort(Math.max(0, settings.afond.dailyGoal - 1));
      return [
        { value: 0, bracket: 'ok', label: `Plus de ${goal} · 0 pt` },
        {
          value: settings.afond.midPoints,
          bracket: 'mid',
          label: `Entre ${mid} et ${midHigh} · ${settings.afond.midPoints} pts`,
        },
        {
          value: settings.afond.lowPoints,
          bracket: 'low',
          label: `Moins de ${mid} · ${settings.afond.lowPoints} pts`,
        },
      ];
    }
    const goal = formatVsMillionsShort(settings.eco.dailyGoal);
    return [
      { value: 0, bracket: 'ok', label: `Objectif atteint (≥ ${goal}) · 0 pt` },
      {
        value: settings.eco.underPoints,
        bracket: 'low',
        label: `Sous ${goal} · ${settings.eco.underPoints} pts`,
      },
    ];
  }

  function labelForDayPoints(points, stateOrSettings, bracket) {
    const opts = getDayOptions(stateOrSettings);
    if (bracket && VS_BRACKETS.includes(bracket)) {
      const byBracket = opts.find((opt) => opt.bracket === bracket);
      if (byBracket) return byBracket.label;
    }
    const p = Number(points) || 0;
    const exact = opts.find((opt) => Number(opt.value) === p);
    if (exact) return exact.label;
    const legacy = DAY_OPTIONS.find((opt) => Number(opt.value) === p);
    if (legacy) return legacy.label;
    return `${p} pts`;
  }

  function ensureDayBrackets(score) {
    if (!score.dayBrackets || typeof score.dayBrackets !== 'object') {
      score.dayBrackets = {};
    }
    DAYS.forEach((day) => {
      const existing = score.dayBrackets[day.key];
      if (VS_BRACKETS.includes(existing)) return;
      score.dayBrackets[day.key] = inferDayBracket(score.days?.[day.key]);
    });
    return score.dayBrackets;
  }

  function applyVsBaremeToScore(score, stateOrSettings) {
    if (!score) return score;
    const brackets = ensureDayBrackets(score);
    DAYS.forEach((day) => {
      const bracket = brackets[day.key] || 'ok';
      score.days[day.key] = pointsForBracket(bracket, stateOrSettings);
    });
    return score;
  }

  function recalculateWeekWithBareme(week, stateOrSettings) {
    if (!week || !week.scores) return week;
    Object.keys(week.scores).forEach((playerId) => {
      applyVsBaremeToScore(week.scores[playerId], stateOrSettings);
    });
    return week;
  }

  function countDaysUnderObjective(score) {
    if (!score?.days) return 0;
    return DAYS.reduce((sum, day) => sum + ((Number(score.days[day.key]) || 0) > 0 ? 1 : 0), 0);
  }

  function countObjectivesMet(score) {
    return DAYS.length - countDaysUnderObjective(score);
  }

  /** Tranches de puissance héros par défaut (liste centrale — ne pas dupliquer ailleurs). */
  const DEFAULT_POWER_TIER_DEFS = [
    { label: '25 à 30 M', min: 25, max: 30 },
    { label: '30 à 35 M', min: 30, max: 35 },
    { label: '35 à 40 M', min: 35, max: 40 },
    { label: '40 à 45 M', min: 40, max: 45 },
    { label: '45 à 50 M', min: 45, max: 50 },
    { label: '50 à 55 M', min: 50, max: 55 },
    { label: '55 à 60 M', min: 55, max: 60 },
    { label: '60 à 65 M', min: 60, max: 65 },
    { label: '65 à 70 M', min: 65, max: 70 },
    { label: '70 à 75 M', min: 70, max: 75 },
    { label: '75 à 80 M', min: 75, max: 80 },
  ];

  function createDefaultPowerTiers() {
    return DEFAULT_POWER_TIER_DEFS.map((def, index) => ({
      id: `tier_${def.min}_${def.max}`,
      label: def.label,
      min: def.min,
      max: def.max,
      order: index + 1,
    }));
  }

  function normalizePowerTier(raw, index = 0) {
    const min = Number(raw?.min);
    const max = Number(raw?.max);
    const safeMin = Number.isFinite(min) ? min : 0;
    const safeMax = Number.isFinite(max) ? max : safeMin;
    const label = String(raw?.label || '').trim() || `${safeMin} à ${safeMax} M`;
    const order = Number(raw?.order);
    return {
      id: String(raw?.id || '').trim() || uid('tier'),
      label,
      min: Math.min(safeMin, safeMax),
      max: Math.max(safeMin, safeMax),
      order: Number.isFinite(order) && order > 0 ? order : index + 1,
    };
  }

  function normalizePowerTiers(raw) {
    if (!Array.isArray(raw) || !raw.length) return createDefaultPowerTiers();
    const seen = new Set();
    return raw
      .map((item, index) => normalizePowerTier(item, index))
      .filter((tier) => {
        if (seen.has(tier.id)) return false;
        seen.add(tier.id);
        return true;
      })
      .sort((a, b) => a.order - b.order || a.min - b.min || a.label.localeCompare(b.label, 'fr'));
  }

  function getSortedPowerTiers(stateOrTiers) {
    const tiers = Array.isArray(stateOrTiers)
      ? stateOrTiers
      : normalizePowerTiers(stateOrTiers?.powerTiers);
    return tiers.slice().sort((a, b) => a.order - b.order || a.min - b.min);
  }

  function getPowerTiers(state) {
    return getSortedPowerTiers(state);
  }

  function getPowerTierById(stateOrTiers, tierId) {
    if (!tierId) return null;
    const tiers = getSortedPowerTiers(stateOrTiers);
    return tiers.find((t) => t.id === tierId) || null;
  }

  function migrateHeroPowerTierId(player, tiers) {
    const existing = String(player?.heroPowerTierId || '').trim();
    if (existing && tiers.some((t) => t.id === existing)) return existing;
    // Ancienne donnée sans tranche (ou ancienne valeur numérique libre) → Non renseignée
    return null;
  }

  function getPlayerPowerTier(player, stateOrTiers) {
    const tiers = getSortedPowerTiers(stateOrTiers);
    const tierId = String(player?.heroPowerTierId || '').trim();
    if (!tierId) return null;
    return tiers.find((t) => t.id === tierId) || null;
  }

  /** Valeur de tri : max de la tranche (plus élevé = plus fort). Non renseignée = -1. */
  function getPlayerPowerSortValue(player, stateOrTiers) {
    const tier = getPlayerPowerTier(player, stateOrTiers);
    return tier ? Number(tier.max) : -1;
  }

  function getPlayerPowerLabel(player, stateOrTiers) {
    const tier = getPlayerPowerTier(player, stateOrTiers);
    return tier ? tier.label : 'Non renseignée';
  }

  function countPlayersUsingPowerTier(state, tierId) {
    if (!tierId || !state?.players) return 0;
    return state.players.filter((p) => p.heroPowerTierId === tierId).length;
  }

  function buildPowerTierSelectOptions(tiers, selectedId = '') {
    const sorted = getSortedPowerTiers(tiers);
    const opts = [`<option value="">Non renseignée</option>`];
    sorted.forEach((tier) => {
      const sel = tier.id === selectedId ? ' selected' : '';
      opts.push(
        `<option value="${escapeAttr(tier.id)}"${sel}>${escapeHtmlLite(tier.label)}</option>`
      );
    });
    return opts.join('');
  }

  function escapeAttr(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;');
  }

  function escapeHtmlLite(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function uid(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function startOfWeekMonday(date = new Date()) {
    const d = new Date(date);
    d.setHours(12, 0, 0, 0);
    const day = d.getDay(); // 0 = dimanche
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    return d;
  }

  function addDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  }

  function toISODate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function formatDateFR(isoDate) {
    if (!isoDate) return '—';
    const [y, m, d] = isoDate.split('-');
    return `${d}/${m}/${y}`;
  }

  function createEmptyScore() {
    return {
      days: {
        lundi: 0,
        mardi: 0,
        mercredi: 0,
        jeudi: 0,
        vendredi: 0,
      },
      dayBrackets: {
        lundi: 'ok',
        mardi: 'ok',
        mercredi: 'ok',
        jeudi: 'ok',
        vendredi: 'ok',
      },
      allianceDonMissed: false,
    };
  }

  function getNextWeekNumber(weeks) {
    const max = (weeks || []).reduce((acc, week) => {
      const n = Number(week.number);
      return Number.isFinite(n) ? Math.max(acc, n) : acc;
    }, 0);
    return max + 1;
  }

  function createWeek(referenceDate = new Date(), options = {}) {
    const monday = startOfWeekMonday(referenceDate);
    const friday = addDays(monday, 4);
    const startDate = toISODate(monday);
    const endDate = toISODate(friday);
    const number = Number(options.number) > 0 ? Number(options.number) : 1;

    return {
      id: uid('week'),
      number,
      label: `Semaine ${number}`,
      startDate,
      endDate,
      createdAt: new Date().toISOString(),
      archived: Boolean(options.archived),
      donationsVerified: false,
      scores: {},
    };
  }

  function isWeekEditable(week, currentWeekId) {
    return Boolean(week && !week.archived && week.id === currentWeekId);
  }

  function createPlayer({
    pseudo,
    role = 'Membre',
    status = 'Actif',
    absent = false,
    heroPowerTierId = null,
    preferredVolant = false,
  }) {
    return {
      id: uid('player'),
      pseudo: String(pseudo || '').trim(),
      role,
      status,
      absent: Boolean(absent),
      heroPowerTierId: heroPowerTierId ? String(heroPowerTierId) : null,
      preferredVolant: Boolean(preferredVolant),
      stormAbsencesUnexcused: 0,
      stormAbsencesExcused: 0,
      createdAt: new Date().toISOString(),
      leftAt: status === 'Parti' ? new Date().toISOString() : null,
    };
  }

  /** Actif et présent : participe au VS / KPI / contacts. */
  function isVsParticipant(player) {
    return Boolean(player && player.status === 'Actif' && !player.absent);
  }

  /** Éligible aux futurs tirages Train (absents exclus). */
  function isEligibleForTrain(player) {
    return Boolean(player && player.status === 'Actif' && !player.absent);
  }

  function ensurePlayerScore(week, playerId) {
    if (!week.scores[playerId]) {
      week.scores[playerId] = createEmptyScore();
    } else {
      ensureDayBrackets(week.scores[playerId]);
    }
    return week.scores[playerId];
  }

  function computeTotal(score, stateOrSettings) {
    if (!score) return 0;
    const dayTotal = DAYS.reduce((sum, day) => sum + (Number(score.days[day.key]) || 0), 0);
    if (!score.allianceDonMissed) return dayTotal;
    const cfg = getActiveVsConfig(stateOrSettings);
    const donation = Number(cfg.donationPenalty);
    return dayTotal + (Number.isFinite(donation) ? donation : DONATION_PENALTY);
  }

  function getColorThresholds(stateOrSettings) {
    const cfg = getActiveVsConfig(stateOrSettings);
    const redFrom = Math.max(1, Number(cfg.redFrom) || 35);
    const orangeFrom = Math.max(1, redFrom - 10);
    return { redFrom, orangeFrom };
  }

  function getColorClass(total, stateOrSettings) {
    const { redFrom, orangeFrom } = getColorThresholds(stateOrSettings);
    if (total >= redFrom) return 'color-red';
    if (total >= orangeFrom) return 'color-orange';
    return 'color-green';
  }

  function getColorLabel(total, stateOrSettings) {
    const color = getColorClass(total, stateOrSettings);
    if (color === 'color-red') return 'Rouge';
    if (color === 'color-orange') return 'Orange';
    return 'Vert';
  }

  function getFlaggedDays(score) {
    if (!score) return [];
    return DAYS.filter((day) => {
      const value = Number(score.days[day.key]) || 0;
      return value > 0;
    }).map((day) => ({
      ...day,
      points: Number(score.days[day.key]) || 0,
    }));
  }

  function colorRank(colorClass) {
    if (colorClass === 'color-red') return 2;
    if (colorClass === 'color-orange') return 1;
    return 0;
  }

  function roleRank(role) {
    if (role === 'R5') return 0;
    if (role === 'R4') return 1;
    return 2;
  }

  function getWeekScoreSummary(week, playerId, stateOrSettings) {
    const score = (week && week.scores && week.scores[playerId]) || createEmptyScore();
    const total = computeTotal(score, stateOrSettings);
    const color = getColorClass(total, stateOrSettings);
    return {
      score,
      total,
      color,
      colorLabel: getColorLabel(total, stateOrSettings),
      flaggedDays: getFlaggedDays(score),
      donationMissed: Boolean(score.allianceDonMissed),
      daysUnderObjective: countDaysUnderObjective(score),
      objectivesMet: countObjectivesMet(score),
      hasRecord: Boolean(week && week.scores && week.scores[playerId]),
    };
  }

  function getSortedWeeks(state) {
    return (state.weeks || []).slice().sort((a, b) => (a.startDate < b.startDate ? 1 : -1));
  }

  function getCurrentWeekFromState(state) {
    const weeks = getSortedWeeks(state);
    return weeks.find((w) => w.id === state.currentWeekId) || weeks[0] || null;
  }

  function getColorHistory(state, playerId) {
    return getSortedWeeks(state).map((week) => {
      const summary = getWeekScoreSummary(week, playerId);
      return {
        weekId: week.id,
        label: week.label,
        startDate: week.startDate,
        total: summary.hasRecord ? summary.total : null,
        color: summary.hasRecord ? summary.color : null,
        colorLabel: summary.hasRecord ? summary.colorLabel : null,
        donationMissed: summary.hasRecord ? summary.donationMissed : false,
        hasRecord: summary.hasRecord,
      };
    });
  }

  /** Nombre de semaines rouges consécutives en partant de la semaine courante. */
  function countConsecutiveRed(state, playerId) {
    const weeks = getSortedWeeks(state);
    const currentIndex = weeks.findIndex((w) => w.id === state.currentWeekId);
    const start = currentIndex >= 0 ? currentIndex : 0;
    let count = 0;
    for (let i = start; i < weeks.length; i += 1) {
      const summary = getWeekScoreSummary(weeks[i], playerId);
      if (!summary.hasRecord || summary.color !== 'color-red') break;
      count += 1;
    }
    return count;
  }

  /** Dons non réalisés sur les N semaines les plus récentes (depuis la courante). */
  function countConsecutiveMissedDonations(state, playerId) {
    const weeks = getSortedWeeks(state);
    const currentIndex = weeks.findIndex((w) => w.id === state.currentWeekId);
    const start = currentIndex >= 0 ? currentIndex : 0;
    let count = 0;
    for (let i = start; i < weeks.length; i += 1) {
      const summary = getWeekScoreSummary(weeks[i], playerId);
      if (!summary.hasRecord || !summary.donationMissed) break;
      count += 1;
    }
    return count;
  }

  function createBlankUiState() {
    return {
      completedActionsByDate: {},
      heroPowerWeeklyChecks: {},
      heroPowerWeeklyHistory: [],
      coachingContacts: {},
    };
  }

  function createBlankState() {
    const week = createWeek(new Date(), { number: 1, archived: false });
    return {
      version: DATA_VERSION,
      appRole: 'R5',
      players: [],
      weeks: [week],
      currentWeekId: week.id,
      ui: createBlankUiState(),
      playerWeekNotes: {},
      powerTiers: createDefaultPowerTiers(),
      vsSettings: createDefaultVsSettings(),
    };
  }

  /** État de premier lancement (ou reset) : roster ROS6 prérempli, tous Actifs. */
  function createInitialState() {
    const state = createBlankState();
    const players =
      global.ROSSeed && typeof global.ROSSeed.buildSeedPlayers === 'function'
        ? global.ROSSeed.buildSeedPlayers()
        : [];

    state.players = players;
    players.forEach((player) => {
      state.weeks[0].scores[player.id] = createEmptyScore();
    });

    return state;
  }

  function normalizeState(raw) {
    const base = createBlankState();
    if (!raw || typeof raw !== 'object') return createInitialState();

    const powerTiers = normalizePowerTiers(raw.powerTiers);

    const players = Array.isArray(raw.players)
      ? raw.players.map((p) => {
          const heroPowerTierId = migrateHeroPowerTierId(p, powerTiers);
          return {
            id: p.id || uid('player'),
            pseudo: String(p.pseudo || '').trim() || 'Sans pseudo',
            role: PLAYER_ROLES.includes(p.role) ? p.role : 'Membre',
            status: PLAYER_STATUSES.includes(p.status) ? p.status : 'Actif',
            absent: Boolean(p.absent),
            heroPowerTierId,
            preferredVolant: Boolean(p.preferredVolant),
            stormAbsencesUnexcused: Math.max(0, Number(p.stormAbsencesUnexcused) || 0),
            stormAbsencesExcused: Math.max(0, Number(p.stormAbsencesExcused) || 0),
            createdAt: p.createdAt || new Date().toISOString(),
            leftAt: p.leftAt || null,
          };
        })
      : [];

    const vsSettings = normalizeVsSettings(raw.vsSettings);
    const allowedDayPoints = new Set([0, 5, 10, 12]);
    [vsSettings.afond.midPoints, vsSettings.afond.lowPoints, vsSettings.eco.underPoints].forEach((p) => {
      allowedDayPoints.add(Number(p) || 0);
    });

    let weeks = Array.isArray(raw.weeks) && raw.weeks.length
      ? raw.weeks.map((w) => {
          const scores = {};
          const sourceScores = w.scores && typeof w.scores === 'object' ? w.scores : {};
          Object.keys(sourceScores).forEach((playerId) => {
            const s = sourceScores[playerId] || {};
            const days = s.days || {};
            const sourceBrackets =
              s.dayBrackets && typeof s.dayBrackets === 'object' ? s.dayBrackets : {};
            const normalizeDayPoints = (value) => {
              const n = Number(value);
              if (!Number.isFinite(n) || n < 0) return 0;
              if (allowedDayPoints.has(n)) return n;
              // Conserve les anciennes valeurs non listées (pas de perte de données)
              return Math.round(n);
            };
            const score = {
              days: {
                lundi: normalizeDayPoints(days.lundi),
                mardi: normalizeDayPoints(days.mardi),
                mercredi: normalizeDayPoints(days.mercredi),
                jeudi: normalizeDayPoints(days.jeudi),
                vendredi: normalizeDayPoints(days.vendredi),
              },
              dayBrackets: {
                lundi: VS_BRACKETS.includes(sourceBrackets.lundi)
                  ? sourceBrackets.lundi
                  : inferDayBracket(days.lundi),
                mardi: VS_BRACKETS.includes(sourceBrackets.mardi)
                  ? sourceBrackets.mardi
                  : inferDayBracket(days.mardi),
                mercredi: VS_BRACKETS.includes(sourceBrackets.mercredi)
                  ? sourceBrackets.mercredi
                  : inferDayBracket(days.mercredi),
                jeudi: VS_BRACKETS.includes(sourceBrackets.jeudi)
                  ? sourceBrackets.jeudi
                  : inferDayBracket(days.jeudi),
                vendredi: VS_BRACKETS.includes(sourceBrackets.vendredi)
                  ? sourceBrackets.vendredi
                  : inferDayBracket(days.vendredi),
              },
              allianceDonMissed: Boolean(s.allianceDonMissed),
            };
            scores[playerId] = score;
          });

          return {
            id: w.id || uid('week'),
            number: Number(w.number) > 0 ? Number(w.number) : null,
            label: w.label || null,
            startDate: w.startDate || toISODate(startOfWeekMonday()),
            endDate: w.endDate || toISODate(addDays(startOfWeekMonday(), 4)),
            createdAt: w.createdAt || new Date().toISOString(),
            archived: Boolean(w.archived),
            closedAt: w.closedAt || null,
            closedBy: w.closedBy || '',
            closedByUserId: w.closedByUserId || '',
            closedByPlayerId: w.closedByPlayerId || null,
            donationsVerified: Boolean(w.donationsVerified),
            scores,
          };
        })
      : base.weeks;

    // Trier les semaines du plus récent au plus ancien
    weeks = weeks.slice().sort((a, b) => (a.startDate < b.startDate ? 1 : -1));

    // Numérotation rétroactive stable (plus ancienne = 1) si absente
    const chronological = weeks.slice().sort((a, b) => (a.startDate > b.startDate ? 1 : -1));
    chronological.forEach((week, index) => {
      if (!(Number(week.number) > 0)) week.number = index + 1;
      if (!week.label || /^Semaine du /.test(week.label)) {
        week.label = `Semaine ${week.number}`;
      }
    });

    let currentWeekId = raw.currentWeekId;
    if (!weeks.some((w) => w.id === currentWeekId)) {
      currentWeekId = weeks[0].id;
    }

    // Seule la semaine courante reste éditable ; les autres sont archivées
    weeks.forEach((week) => {
      week.archived = week.id !== currentWeekId;
    });

    const rawUi = raw.ui && typeof raw.ui === 'object' ? raw.ui : {};
    const completedActionsByDate =
      rawUi.completedActionsByDate && typeof rawUi.completedActionsByDate === 'object'
        ? rawUi.completedActionsByDate
        : {};
    const heroPowerWeeklyChecks =
      rawUi.heroPowerWeeklyChecks && typeof rawUi.heroPowerWeeklyChecks === 'object'
        ? rawUi.heroPowerWeeklyChecks
        : {};
    const heroPowerWeeklyHistory = Array.isArray(rawUi.heroPowerWeeklyHistory)
      ? rawUi.heroPowerWeeklyHistory
      : [];
    const coachingContacts =
      rawUi.coachingContacts && typeof rawUi.coachingContacts === 'object'
        ? rawUi.coachingContacts
        : {};

    const playerWeekNotes =
      raw.playerWeekNotes && typeof raw.playerWeekNotes === 'object' ? raw.playerWeekNotes : {};

    const normalized = {
      version: DATA_VERSION,
      appRole: APP_ROLES.includes(raw.appRole) ? raw.appRole : 'R5',
      players,
      weeks,
      currentWeekId,
      ui: {
        completedActionsByDate,
        heroPowerWeeklyChecks,
        heroPowerWeeklyHistory,
        coachingContacts,
      },
      playerWeekNotes,
      powerTiers,
      vsSettings,
    };

    // Compatibilité : anciennes clés « pseudo » → identifiant interne
    if (global.ROSPlayerIdentity && typeof global.ROSPlayerIdentity.migrateMainState === 'function') {
      global.ROSPlayerIdentity.migrateMainState(normalized);
    }

    // Première migration VS : mode ÉCO par défaut + recalcul de la semaine active uniquement
    const hadVsSettings = Boolean(raw.vsSettings && typeof raw.vsSettings === 'object');
    if (!hadVsSettings) {
      const active = normalized.weeks.find((w) => w.id === normalized.currentWeekId);
      if (active && !active.archived) {
        recalculateWeekWithBareme(active, normalized);
      }
    }

    return normalized;
  }

  function canReset(appRole) {
    return appRole === 'R5';
  }

  function canImportOverwrite(appRole) {
    return appRole === 'R5';
  }

  global.ROSModels = {
    DAYS,
    DAY_OPTIONS,
    PLAYER_ROLES,
    PLAYER_STATUSES,
    APP_ROLES,
    DONATION_PENALTY,
    DATA_VERSION,
    VS_BRACKETS,
    VS_MODES,
    uid,
    startOfWeekMonday,
    addDays,
    toISODate,
    formatDateFR,
    createEmptyScore,
    getNextWeekNumber,
    createWeek,
    isWeekEditable,
    createPlayer,
    getPlayerDisplayName(stateOrPlayers, playerId, fallback) {
      if (global.ROSPlayerIdentity) {
        return global.ROSPlayerIdentity.getDisplayName(stateOrPlayers, playerId, fallback);
      }
      const list = Array.isArray(stateOrPlayers) ? stateOrPlayers : stateOrPlayers?.players || [];
      return list.find((p) => p.id === playerId)?.pseudo || fallback || '—';
    },
    isVsParticipant,
    isEligibleForTrain,
    ensurePlayerScore,
    computeTotal,
    getColorClass,
    getColorLabel,
    getColorThresholds,
    getFlaggedDays,
    colorRank,
    roleRank,
    getWeekScoreSummary,
    getSortedWeeks,
    getCurrentWeekFromState,
    getColorHistory,
    countConsecutiveRed,
    countConsecutiveMissedDonations,
    createDefaultVsSettings,
    normalizeVsSettings,
    getVsSettings,
    getActiveVsConfig,
    formatVsMillions,
    formatVsMillionsShort,
    inferDayBracket,
    pointsForBracket,
    getDayOptions,
    labelForDayPoints,
    ensureDayBrackets,
    applyVsBaremeToScore,
    recalculateWeekWithBareme,
    countDaysUnderObjective,
    countObjectivesMet,
    createDefaultPowerTiers,
    normalizePowerTier,
    normalizePowerTiers,
    getSortedPowerTiers,
    getPowerTiers,
    getPowerTierById,
    getPlayerPowerTier,
    getPlayerPowerSortValue,
    getPlayerPowerLabel,
    countPlayersUsingPowerTier,
    buildPowerTierSelectOptions,
    createBlankState,
    createBlankUiState,
    createInitialState,
    normalizeState,
    canReset,
    canImportOverwrite,
  };
})(window);
