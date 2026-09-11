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
  /** high = gros score (félicitations), ok = score fait, mid/low = sous objectif */
  const VS_BRACKETS = ['high', 'ok', 'mid', 'low'];
  const VS_MODES = ['eco', 'afond'];

  function createDefaultVsSettings() {
    return {
      mode: 'afond',
      afond: {
        dailyGoal: 7200000,
        /** Seuil « gros score » (ex. 20 M) — option VS à féliciter, modifiable. */
        praiseGoal: 20000000,
        midMin: 3600000,
        /** Conservés pour compat données anciennes ; plus exposés ni utilisés pour le suivi. */
        midPoints: 1,
        lowPoints: 1,
        donationPenalty: 0,
        redFrom: 4,
      },
      eco: {
        dailyGoal: 3600000,
        underPoints: 1,
        donationPenalty: 0,
        redFrom: 4,
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
        praiseGoal: Math.max(
          toPositiveInt(afondSrc.praiseGoal, defaults.afond.praiseGoal),
          toPositiveInt(afondSrc.dailyGoal, defaults.afond.dailyGoal)
        ),
        midMin: toPositiveInt(afondSrc.midMin, defaults.afond.midMin),
        midPoints: defaults.afond.midPoints,
        lowPoints: defaults.afond.lowPoints,
        donationPenalty: defaults.afond.donationPenalty,
        redFrom: defaults.afond.redFrom,
      },
      eco: {
        dailyGoal: toPositiveInt(ecoSrc.dailyGoal, defaults.eco.dailyGoal),
        underPoints: defaults.eco.underPoints,
        donationPenalty: defaults.eco.donationPenalty,
        redFrom: defaults.eco.redFrom,
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
    const key = VS_BRACKETS.includes(bracket) ? bracket : 'ok';
    // Plus de barème de points : 0 = objectif atteint, 1 = sous objectif (compteur de jours).
    if (key === 'high' || key === 'ok') return 0;
    return 1;
  }

  function getDayOptions(stateOrSettings) {
    const settings = getVsSettings(stateOrSettings);
    if (settings.mode === 'afond') {
      const praise = formatVsMillionsShort(settings.afond.praiseGoal);
      const goal = formatVsMillionsShort(settings.afond.dailyGoal);
      const mid = formatVsMillionsShort(settings.afond.midMin);
      const midHigh = formatVsMillionsShort(Math.max(0, settings.afond.dailyGoal - 1));
      return [
        {
          value: 0,
          bracket: 'high',
          label: `Plus de ${praise}`,
        },
        { value: 0, bracket: 'ok', label: `Score fait (≥ ${goal})` },
        {
          value: 1,
          bracket: 'mid',
          label: `Entre ${mid} et ${midHigh}`,
        },
        {
          value: 1,
          bracket: 'low',
          label: `Moins de ${mid}`,
        },
      ];
    }
    const goal = formatVsMillionsShort(settings.eco.dailyGoal);
    return [
      { value: 0, bracket: 'ok', label: `Objectif atteint (≥ ${goal})` },
      {
        value: 1,
        bracket: 'low',
        label: `Sous ${goal}`,
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
    if (!score) return 0;
    const brackets = ensureDayBrackets(score);
    return DAYS.reduce((sum, day) => {
      const b = brackets[day.key];
      if (b === 'mid' || b === 'low') return sum + 1;
      // Compat anciennes données sans bracket fiable : points > 0 = sous objectif
      if (!VS_BRACKETS.includes(b) && (Number(score.days?.[day.key]) || 0) > 0) return sum + 1;
      return sum;
    }, 0);
  }

  function countObjectivesMet(score) {
    return DAYS.length - countDaysUnderObjective(score);
  }

  /** Jours marqués « gros score » (bracket high). */
  function countHighDays(score) {
    if (!score) return 0;
    const brackets = ensureDayBrackets(score);
    return DAYS.reduce((sum, day) => sum + (brackets[day.key] === 'high' ? 1 : 0), 0);
  }

  /** Semaine à féliciter : assez de scores faits + assez de jours gros score. */
  function isPraiseWeekScore(score, state) {
    if (!score || isScoreAbsent(score)) return false;
    const settings = getFollowUpSettings(state);
    return (
      countObjectivesMet(score) >= settings.vsPraiseMinDaysMet &&
      countHighDays(score) >= settings.vsPraiseMinHighDays
    );
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

  /**
   * Tranches de puissance globale (M) — distinctes de la puissance héros.
   * Ordre de force croissant via sortValue.
   */
  function createGlobalPowerTiers() {
    const tiers = [{ id: 'gp_lt_45', label: 'Moins de 45 M', sortValue: 44.9 }];
    for (let start = 45; start <= 195; start += 5) {
      const endLabel = `${start + 4},9`;
      tiers.push({
        id: `gp_${start}_${start + 5}`,
        label: `${start} à ${endLabel} M`,
        sortValue: start + 4.9,
      });
    }
    tiers.push({ id: 'gp_ge_200', label: '200 M et plus', sortValue: 200 });
    return tiers;
  }

  const GLOBAL_POWER_TIERS = createGlobalPowerTiers();
  const GLOBAL_POWER_TIER_IDS = new Set(GLOBAL_POWER_TIERS.map((t) => t.id));

  function getGlobalPowerTiers() {
    return GLOBAL_POWER_TIERS.slice();
  }

  function normalizeGlobalPowerTierId(value) {
    const id = String(value || '').trim();
    if (!id) return null;
    return GLOBAL_POWER_TIER_IDS.has(id) ? id : null;
  }

  function getGlobalPowerTierById(tierId) {
    const id = normalizeGlobalPowerTierId(tierId);
    if (!id) return null;
    return GLOBAL_POWER_TIERS.find((t) => t.id === id) || null;
  }

  function getPlayerGlobalPowerTier(player) {
    return getGlobalPowerTierById(player?.globalPowerTierId);
  }

  function getPlayerGlobalPowerLabel(player) {
    const tier = getPlayerGlobalPowerTier(player);
    return tier ? tier.label : 'Non renseignée';
  }

  /** Plus élevé = plus fort. Non renseignée = -1. */
  function getPlayerGlobalPowerSortValue(player) {
    const tier = getPlayerGlobalPowerTier(player);
    return tier ? Number(tier.sortValue) : -1;
  }

  function buildGlobalPowerSelectOptions(selectedId = '') {
    const selected = normalizeGlobalPowerTierId(selectedId) || '';
    const opts = [`<option value="">Non renseignée</option>`];
    GLOBAL_POWER_TIERS.forEach((tier) => {
      const sel = tier.id === selected ? ' selected' : '';
      opts.push(
        `<option value="${escapeAttr(tier.id)}"${sel}>${escapeHtmlLite(tier.label)}</option>`
      );
    });
    return opts.join('');
  }

  /**
   * Valeur représentative d’une tranche héros (milieu min/max).
   * Ex. 35–40 → 37,5. Null si non renseignée.
   */
  function getHeroPowerRepresentativeValue(player, stateOrTiers) {
    const tier = getPlayerPowerTier(player, stateOrTiers);
    if (!tier) return null;
    const min = Number(tier.min);
    const max = Number(tier.max);
    if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
    return (min + max) / 2;
  }

  /**
   * Valeur représentative d’une tranche globale.
   * Bandes fermées : milieu ; ouvertes : même largeur 5 M sans avantage artificiel.
   */
  function getGlobalPowerRepresentativeValue(player) {
    const tier = getPlayerGlobalPowerTier(player);
    if (!tier) return null;
    if (tier.id === 'gp_lt_45') return 42.5;
    if (tier.id === 'gp_ge_200') return 202.5;
    const match = String(tier.id).match(/^gp_(\d+)_(\d+)$/);
    if (match) {
      const start = Number(match[1]);
      const endExclusive = Number(match[2]);
      if (Number.isFinite(start) && Number.isFinite(endExclusive)) {
        return (start + (endExclusive - 0.1)) / 2;
      }
    }
    const sort = Number(tier.sortValue);
    return Number.isFinite(sort) ? sort - 2.45 : null;
  }

  function hasCompletePowerData(player, stateOrTiers) {
    return (
      getHeroPowerRepresentativeValue(player, stateOrTiers) != null &&
      getGlobalPowerRepresentativeValue(player) != null
    );
  }

  function normalizeValueList(values) {
    if (!values.length) return [];
    let min = values[0];
    let max = values[0];
    values.forEach((v) => {
      if (v < min) min = v;
      if (v > max) max = v;
    });
    if (max === min) return values.map(() => 50);
    return values.map((v) => ((v - min) / (max - min)) * 100);
  }

  /**
   * Score puissance commun (0–100) : 70 % héros normalisé + 30 % global normalisé.
   * Normalisation relative à la population fournie (joueurs aux données complètes).
   * Retourne Map(playerId → { score, heroNorm, globalNorm, heroRaw, globalRaw }).
   */
  function buildCompositePowerScoreMap(players, stateOrTiers) {
    const list = Array.isArray(players) ? players : [];
    const complete = list.filter((p) => hasCompletePowerData(p, stateOrTiers));
    const map = new Map();
    if (!complete.length) return map;

    const heroRaws = complete.map((p) => getHeroPowerRepresentativeValue(p, stateOrTiers));
    const globalRaws = complete.map((p) => getGlobalPowerRepresentativeValue(p));
    const heroNorms = normalizeValueList(heroRaws);
    const globalNorms = normalizeValueList(globalRaws);

    complete.forEach((player, index) => {
      const heroNorm = heroNorms[index];
      const globalNorm = globalNorms[index];
      const score = 0.7 * heroNorm + 0.3 * globalNorm;
      map.set(player.id, {
        score,
        heroNorm,
        globalNorm,
        heroRaw: heroRaws[index],
        globalRaw: globalRaws[index],
      });
    });
    return map;
  }

  function getPlayerCompositePowerScore(player, scoreMap) {
    if (!player?.id || !scoreMap) return null;
    const row = scoreMap.get(player.id);
    return row && Number.isFinite(row.score) ? row.score : null;
  }

  /** Puissance globale : édition réservée aux R4 et R5 actifs. */
  function canEditGlobalPower() {
    if (global.ROSProfiles && typeof global.ROSProfiles.isActiveR4OrR5 === 'function') {
      return Boolean(global.ROSProfiles.isActiveR4OrR5());
    }
    if (global.ROSProfiles && typeof global.ROSProfiles.isAccessAllowed === 'function') {
      if (!global.ROSProfiles.isAccessAllowed()) return false;
    }
    if (global.ROSProfiles && typeof global.ROSProfiles.getAppRole === 'function') {
      const role = global.ROSProfiles.getAppRole();
      return role === 'R5' || role === 'R4';
    }
    const shared = global.ROSStorage ? global.ROSStorage.getState()?.appRole : null;
    return shared === 'R5' || shared === 'R4';
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

  function createEmptyScore(options = {}) {
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
      /** Snapshot historique (renseigné à la clôture) ; absent des anciennes données = false. */
      absent: Boolean(options.absent),
    };
  }

  function isScoreAbsent(score) {
    return Boolean(score && score.absent);
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
    return Boolean(
      week && currentWeekId && !week.archived && week.id === currentWeekId
    );
  }

  function createPlayer({
    pseudo,
    role = 'Membre',
    status = 'Actif',
    absent = false,
    inactive = false,
    heroPowerTierId = null,
    globalPowerTierId = null,
    preferredVolant = false,
    coachingException = 'always',
  }) {
    return {
      id: uid('player'),
      pseudo: String(pseudo || '').trim(),
      role,
      status,
      absent: Boolean(absent),
      inactive: Boolean(inactive),
      heroPowerTierId: heroPowerTierId ? String(heroPowerTierId) : null,
      globalPowerTierId: normalizeGlobalPowerTierId(globalPowerTierId),
      preferredVolant: Boolean(preferredVolant),
      coachingException: coachingException === 'never' ? 'never' : 'always',
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
    // Ancien total de points → désormais = jours sous objectif (Train / KPI / compat).
    if (!score || isScoreAbsent(score)) return 0;
    return countDaysUnderObjective(score);
  }

  /** Seuils couleur : basés sur le nombre de jours sous objectif (plus sur un total de pts). */
  function getColorThresholds(_stateOrSettings) {
    return { orangeFrom: 2, redFrom: 4 };
  }

  function getColorClass(underDays, _stateOrSettings) {
    const n = Number(underDays) || 0;
    const { redFrom, orangeFrom } = getColorThresholds();
    if (n >= redFrom) return 'color-red';
    if (n >= orangeFrom) return 'color-orange';
    return 'color-green';
  }

  function getColorLabel(underDays, stateOrSettings) {
    const color = getColorClass(underDays, stateOrSettings);
    if (color === 'color-red') return 'Rouge';
    if (color === 'color-orange') return 'Orange';
    return 'Vert';
  }

  function getFlaggedDays(score) {
    if (!score) return [];
    const brackets = ensureDayBrackets(score);
    return DAYS.filter((day) => {
      const b = brackets[day.key];
      return b === 'mid' || b === 'low' || (Number(score.days?.[day.key]) || 0) > 0;
    }).map((day) => ({
      ...day,
      points: Number(score.days[day.key]) || 0,
      bracket: brackets[day.key] || 'low',
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
    if (!week) {
      const empty = createEmptyScore();
      return {
        score: empty,
        total: 0,
        color: 'color-green',
        colorLabel: 'Vert',
        flaggedDays: [],
        donationMissed: false,
        daysUnderObjective: 0,
        objectivesMet: 5,
        hasRecord: false,
        absent: false,
      };
    }
    const score = (week.scores && week.scores[playerId]) || createEmptyScore();
    const absent = isScoreAbsent(score);
    const total = absent ? 0 : computeTotal(score, stateOrSettings);
    const color = absent ? 'color-green' : getColorClass(total, stateOrSettings);
    return {
      score,
      total,
      color,
      colorLabel: getColorLabel(total, stateOrSettings),
      flaggedDays: absent ? [] : getFlaggedDays(score),
      donationMissed: absent ? false : Boolean(score.allianceDonMissed),
      daysUnderObjective: absent ? 0 : countDaysUnderObjective(score),
      objectivesMet: absent ? 5 : countObjectivesMet(score),
      hasRecord: Boolean(week.scores && week.scores[playerId]),
      absent,
    };
  }

  function getSortedWeeks(state) {
    return (state.weeks || []).slice().sort((a, b) => (a.startDate < b.startDate ? 1 : -1));
  }

  /** Semaine VS active uniquement ; null s’il n’y en a pas. */
  function getCurrentWeekFromState(state) {
    if (!state || !state.currentWeekId) return null;
    const weeks = state.weeks || [];
    return weeks.find((w) => w.id === state.currentWeekId) || null;
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

  function createDefaultAllianceSettings() {
    return {
      name: 'ROS6',
      tag: 'ROS6',
      server: '602',
      language: 'fr',
    };
  }

  function normalizeAllianceSettings(raw) {
    const defaults = createDefaultAllianceSettings();
    const language = String(raw?.language || '').trim().toLowerCase();
    const allowedLang = language === 'en' ? 'en' : 'fr';
    const name = String(raw?.name || '').trim() || defaults.name;
    const tag = String(raw?.tag || '').trim() || name || defaults.tag;
    const server = String(raw?.server ?? '').trim() || defaults.server;
    return { name, tag, server, language: allowedLang };
  }

  function getAllianceSettings(state) {
    return normalizeAllianceSettings(state?.alliance);
  }

  /** Nom affiché de l’alliance (paramètres). */
  function getAllianceName(state) {
    return getAllianceSettings(state).name;
  }

  /** Tag alliance (paramètres). */
  function getAllianceTag(state) {
    return getAllianceSettings(state).tag;
  }

  function createBlankState() {
    return {
      version: DATA_VERSION,
      appRole: 'R5',
      players: [],
      weeks: [],
      currentWeekId: null,
      ui: createBlankUiState(),
      playerWeekNotes: {},
      powerTiers: createDefaultPowerTiers(),
      vsSettings: createDefaultVsSettings(),
      coachingThreshold: createDefaultCoachingThreshold(),
      followUpSettings: createDefaultFollowUpSettings(),
      playerFollowUps: {},
      /** Compteur léger VS sous seuil (fenêtre glissante, sans garder les semaines). */
      playerVsUnderStats: {},
      alliance: createDefaultAllianceSettings(),
      /** Journal minimal des changements de Puissance globale (sync / audit). */
      globalPowerAudit: [],
    };
  }

  function normalizeGlobalPowerAudit(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((e) => e && typeof e === 'object' && e.playerId)
      .map((e) => ({
        id: e.id || uid('gpa'),
        playerId: String(e.playerId),
        pseudo: e.pseudo != null ? String(e.pseudo) : '',
        from: normalizeGlobalPowerTierId(e.from),
        to: normalizeGlobalPowerTierId(e.to),
        at: e.at || new Date().toISOString(),
        actorUserId: e.actorUserId != null ? String(e.actorUserId) : '',
        actorLabel: e.actorLabel != null ? String(e.actorLabel) : '',
      }))
      .slice(0, 200);
  }

  function createDefaultCoachingThreshold() {
    return { min: 25, max: 30 };
  }

  function normalizeCoachingThreshold(raw) {
    const defaults = createDefaultCoachingThreshold();
    const min = Number(raw?.min);
    const max = Number(raw?.max);
    const safeMin = Number.isFinite(min) ? min : defaults.min;
    const safeMax = Number.isFinite(max) ? max : defaults.max;
    return {
      min: Math.min(safeMin, safeMax),
      max: Math.max(safeMin, safeMax),
    };
  }

  function getCoachingThreshold(state) {
    return normalizeCoachingThreshold(state?.coachingThreshold);
  }

  function createDefaultFollowUpSettings() {
    return {
      /** Nombre de jours sous objectif VS (ex. &lt; 7,2 M) pour déclencher un suivi. */
      vsMinUnderDays: 2,
      /** Jours « Score fait » min (objectif quotidien atteint) pour féliciter. */
      vsPraiseMinDaysMet: 5,
      /** Jours « gros score » (seuil praiseGoal VS) min pour féliciter. */
      vsPraiseMinHighDays: 1,
      /** Puissance héros max (M) : tranche.max ≤ cette valeur → suivi héros. */
      heroMaxM: 30,
      /** R4/R5 référents par motif (visibilité + suggestion d’assignation). */
      specialists: emptyFollowUpSpecialists(),
    };
  }

  const FOLLOW_UP_SPECIALIST_KEYS = [
    { id: 'vs', label: 'VS sous seuil' },
    { id: 'praise', label: 'À féliciter' },
    { id: 'hero', label: 'Puissance héros' },
    { id: 'manual', label: 'Aide / manuel' },
  ];

  function emptyFollowUpSpecialists(seed = {}) {
    return {
      vs: seed.vs || null,
      praise: seed.praise || null,
      hero: seed.hero || null,
      manual: seed.manual || null,
    };
  }

  function normalizeFollowUpSpecialists(raw) {
    const out = emptyFollowUpSpecialists();
    if (!raw || typeof raw !== 'object') return out;
    FOLLOW_UP_SPECIALIST_KEYS.forEach(({ id }) => {
      const value = raw[id];
      out[id] = value ? String(value) : null;
    });
    return out;
  }

  function normalizeFollowUpSettings(raw) {
    const defaults = createDefaultFollowUpSettings();
    const vsMin = Number(raw?.vsMinUnderDays);
    const praiseMet = Number(raw?.vsPraiseMinDaysMet);
    const praiseHigh = Number(raw?.vsPraiseMinHighDays);
    const heroMax = Number(raw?.heroMaxM);
    return {
      vsMinUnderDays: Number.isFinite(vsMin) && vsMin >= 1 ? Math.round(vsMin) : defaults.vsMinUnderDays,
      vsPraiseMinDaysMet:
        Number.isFinite(praiseMet) && praiseMet >= 1 && praiseMet <= DAYS.length
          ? Math.round(praiseMet)
          : defaults.vsPraiseMinDaysMet,
      vsPraiseMinHighDays:
        Number.isFinite(praiseHigh) && praiseHigh >= 0 && praiseHigh <= DAYS.length
          ? Math.round(praiseHigh)
          : defaults.vsPraiseMinHighDays,
      heroMaxM: Number.isFinite(heroMax) && heroMax >= 0 ? heroMax : defaults.heroMaxM,
      specialists: normalizeFollowUpSpecialists(raw?.specialists),
    };
  }

  function getFollowUpSettings(state) {
    return normalizeFollowUpSettings(state?.followUpSettings);
  }

  /** Motifs dont le joueur est le référent Paramètres. */
  function getFollowUpSpecialistKeysForPlayer(settings, playerId) {
    if (!playerId) return [];
    const specs = normalizeFollowUpSpecialists(settings?.specialists);
    return FOLLOW_UP_SPECIALIST_KEYS.map((k) => k.id).filter((id) => specs[id] === playerId);
  }

  /**
   * Choisit un référent selon les motifs actifs (priorité VS → féliciter → héros → manuel).
   */
  function pickFollowUpSpecialist(reasons, state) {
    const settings = getFollowUpSettings(state);
    const specs = settings.specialists || emptyFollowUpSpecialists();
    const priority = ['vs', 'praise', 'hero', 'manual'];
    for (let i = 0; i < priority.length; i += 1) {
      const key = priority[i];
      if (!reasons?.[key] || !specs[key]) continue;
      const officer = (state?.players || []).find((p) => p.id === specs[key]);
      return {
        assigneePlayerId: specs[key],
        assigneeLabel: officer?.pseudo || specs[key],
      };
    }
    return null;
  }

  /** R5 voit tout ; R4 voit ses motifs référents + fiches assignées. Sans spécialité = voit tout. */
  function isFollowUpVisibleToViewer(row, state, viewerPlayerId, viewerIsR5) {
    if (viewerIsR5 || !viewerPlayerId) return true;
    if (row?.follow?.assigneePlayerId === viewerPlayerId) return true;
    const keys = getFollowUpSpecialistKeysForPlayer(getFollowUpSettings(state), viewerPlayerId);
    if (!keys.length) return true;
    return keys.some((key) => Boolean(row?.reasons?.[key]));
  }

  const FOLLOW_UP_STATUSES = [
    { id: 'to_contact', label: 'À contacter' },
    { id: 'contacted', label: 'Contacté' },
    { id: 'in_progress', label: 'En suivi' },
    { id: 'done', label: 'Suivi terminé' },
  ];

  function normalizeFollowUpStatus(value) {
    const id = String(value || '').trim();
    return FOLLOW_UP_STATUSES.some((s) => s.id === id) ? id : 'to_contact';
  }

  function getFollowUpStatusLabel(statusId) {
    return FOLLOW_UP_STATUSES.find((s) => s.id === statusId)?.label || 'À contacter';
  }

  function emptyFollowUpReasons(seed = {}) {
    return {
      vs: Boolean(seed.vs),
      hero: Boolean(seed.hero),
      praise: Boolean(seed.praise),
      manual: Boolean(seed.manual),
    };
  }

  function createEmptyFollowUpCase(options = {}) {
    const now = new Date().toISOString();
    return {
      status: normalizeFollowUpStatus(options.status),
      reasons: emptyFollowUpReasons(options.reasons),
      manual: Boolean(options.manual || options.reasons?.manual),
      contactedAt: options.contactedAt || null,
      contactReasons: emptyFollowUpReasons(options.contactReasons),
      assigneePlayerId: options.assigneePlayerId || null,
      assigneeLabel: options.assigneeLabel != null ? String(options.assigneeLabel) : '',
      assignedAt: options.assignedAt || null,
      assignedByLabel: options.assignedByLabel != null ? String(options.assignedByLabel) : '',
      notes: Array.isArray(options.notes) ? options.notes : [],
      createdAt: options.createdAt || now,
      updatedAt: options.updatedAt || now,
      closedAt: options.closedAt || null,
    };
  }

  function normalizeFollowUpNote(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const text = String(raw.text || '').trim();
    if (!text) return null;
    return {
      id: raw.id || uid('funote'),
      at: raw.at || new Date().toISOString(),
      text,
      authorLabel: raw.authorLabel != null ? String(raw.authorLabel) : '',
      authorUserId: raw.authorUserId != null ? String(raw.authorUserId) : '',
    };
  }

  function normalizeFollowUpCase(raw) {
    if (!raw || typeof raw !== 'object') return createEmptyFollowUpCase();
    const notes = Array.isArray(raw.notes)
      ? raw.notes.map(normalizeFollowUpNote).filter(Boolean).slice(0, 200)
      : [];
    const assigneePlayerId = raw.assigneePlayerId ? String(raw.assigneePlayerId) : null;
    return {
      status: normalizeFollowUpStatus(raw.status),
      reasons: emptyFollowUpReasons({
        ...raw.reasons,
        manual: Boolean(raw.reasons?.manual || raw.manual),
      }),
      manual: Boolean(raw.manual || raw.reasons?.manual),
      contactedAt: raw.contactedAt || null,
      contactReasons: emptyFollowUpReasons(raw.contactReasons),
      assigneePlayerId,
      assigneeLabel: raw.assigneeLabel != null ? String(raw.assigneeLabel) : '',
      assignedAt: raw.assignedAt || null,
      assignedByLabel: raw.assignedByLabel != null ? String(raw.assignedByLabel) : '',
      notes,
      createdAt: raw.createdAt || new Date().toISOString(),
      updatedAt: raw.updatedAt || raw.createdAt || new Date().toISOString(),
      closedAt: raw.closedAt || null,
    };
  }

  function normalizePlayerFollowUps(raw) {
    if (!raw || typeof raw !== 'object') return {};
    const out = {};
    Object.keys(raw).forEach((playerId) => {
      if (!playerId) return;
      out[playerId] = normalizeFollowUpCase(raw[playerId]);
    });
    return out;
  }

  /** Semaine VS de référence pour le suivi : active, sinon dernière clôturée. */
  function getFollowUpReferenceWeek(state) {
    const weeks = state?.weeks || [];
    if (state?.currentWeekId) {
      const active = weeks.find((w) => w.id === state.currentWeekId);
      if (active) return active;
    }
    const closed = weeks
      .filter((w) => w && w.archived)
      .slice()
      .sort((a, b) => (a.startDate < b.startDate ? 1 : -1));
    return closed[0] || null;
  }

  function countPlayerVsUnderDays(week, playerId) {
    if (!week?.scores || !playerId) return 0;
    const score = week.scores[playerId];
    if (!score || isScoreAbsent(score)) return 0;
    return countDaysUnderObjective(score);
  }

  function detectFollowUpReasons(player, state) {
    const settings = getFollowUpSettings(state);
    const reasons = emptyFollowUpReasons();
    if (!player || player.status !== 'Actif') return reasons;
    // Absent = hors VS uniquement (Liste des membres) — pas un motif de suivi.
    if (player.absent) return reasons;

    const existing = state?.playerFollowUps?.[player.id];
    if (existing?.manual || existing?.reasons?.manual) reasons.manual = true;

    const week = getFollowUpReferenceWeek(state);
    if (week) {
      const underDays = countPlayerVsUnderDays(week, player.id);
      const score = week.scores?.[player.id];
      const hasScore = Boolean(score && !isScoreAbsent(score));
      if (hasScore && underDays >= settings.vsMinUnderDays) reasons.vs = true;
      if (hasScore && isPraiseWeekScore(score, state)) reasons.praise = true;
    } else {
      const last = getPlayerVsUnderStats(state, player.id).entries[0];
      if (last?.under) reasons.vs = true;
      if (last?.praise) reasons.praise = true;
    }

    const heroSort = getPlayerPowerSortValue(player, state);
    if (heroSort >= 0 && heroSort <= settings.heroMaxM) {
      reasons.hero = true;
    }

    return reasons;
  }

  function formatFollowUpReasonsLabel(reasons) {
    const parts = [];
    if (reasons?.vs) parts.push('VS sous seuil');
    if (reasons?.praise) parts.push('À féliciter');
    if (reasons?.hero) parts.push('Puissance héros');
    if (reasons?.manual) parts.push('Aide / manuel');
    return parts.length ? parts.join(' · ') : '—';
  }

  /** Nombre de semaines VS mémorisées dans le compteur léger (plus récentes). */
  const VS_UNDER_HISTORY_LIMIT = 8;

  function createEmptyVsUnderStats() {
    return { entries: [] };
  }

  function normalizeVsUnderEntry(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const underDays = Math.max(0, Math.round(Number(raw.underDays) || 0));
    return {
      weekId: raw.weekId ? String(raw.weekId) : '',
      weekLabel: raw.weekLabel != null ? String(raw.weekLabel) : '',
      startDate: raw.startDate || '',
      underDays,
      under: Boolean(raw.under),
      praise: Boolean(raw.praise),
      at: raw.at || new Date().toISOString(),
    };
  }

  function normalizePlayerVsUnderStats(raw) {
    if (!raw || typeof raw !== 'object') return {};
    const out = {};
    Object.keys(raw).forEach((playerId) => {
      if (!playerId) return;
      const row = raw[playerId];
      const entries = Array.isArray(row?.entries)
        ? row.entries.map(normalizeVsUnderEntry).filter(Boolean).slice(0, VS_UNDER_HISTORY_LIMIT)
        : [];
      out[playerId] = { entries };
    });
    return out;
  }

  function getPlayerVsUnderStats(state, playerId) {
    if (!playerId) return createEmptyVsUnderStats();
    const row = state?.playerVsUnderStats?.[playerId];
    if (!row) return createEmptyVsUnderStats();
    return {
      entries: Array.isArray(row.entries)
        ? row.entries.map(normalizeVsUnderEntry).filter(Boolean)
        : [],
    };
  }

  function summarizeVsUnderStats(stats) {
    const entries = stats?.entries || [];
    const tracked = entries.length;
    const underCount = entries.filter((e) => e.under).length;
    const praiseCount = entries.filter((e) => e.praise).length;
    return { tracked, underCount, praiseCount, entries };
  }

  function formatVsUnderCounterLabel(stats) {
    const { tracked, underCount } = summarizeVsUnderStats(stats);
    if (!tracked) return 'VS sous seuil : —';
    return `VS sous seuil : ${underCount} / ${tracked}`;
  }

  function formatVsPraiseCounterLabel(stats) {
    const { tracked, praiseCount } = summarizeVsUnderStats(stats);
    if (!tracked) return 'À féliciter : —';
    return `À féliciter : ${praiseCount} / ${tracked}`;
  }

  /**
   * Enregistre un snapshot léger à la clôture VS (avant effacement de la semaine).
   * Absents / sans score : ignorés.
   */
  function recordVsUnderSnapshotsForWeek(state, week) {
    if (!state || !week) return state;
    const settings = getFollowUpSettings(state);
    if (!state.playerVsUnderStats || typeof state.playerVsUnderStats !== 'object') {
      state.playerVsUnderStats = {};
    }
    const now = new Date().toISOString();
    const players = (state.players || []).filter((p) => p && p.status === 'Actif');
    players.forEach((player) => {
      if (player.absent) return;
      const score = week.scores?.[player.id];
      if (!score || isScoreAbsent(score)) return;
      const underDays = countDaysUnderObjective(score);
      const under = underDays >= settings.vsMinUnderDays;
      const praise = isPraiseWeekScore(score, state);
      const prev = getPlayerVsUnderStats(state, player.id);
      const withoutDup = prev.entries.filter((e) => e.weekId !== week.id);
      withoutDup.unshift({
        weekId: week.id,
        weekLabel: week.label || `Semaine ${week.number || ''}`.trim(),
        startDate: week.startDate || '',
        underDays,
        under,
        praise,
        at: now,
      });
      state.playerVsUnderStats[player.id] = {
        entries: withoutDup.slice(0, VS_UNDER_HISTORY_LIMIT),
      };
    });
    return state;
  }

  function formatCoachingThresholdLabel(threshold) {
    const th = normalizeCoachingThreshold(threshold);
    const fmt = (n) => {
      const v = Number(n);
      if (!Number.isFinite(v)) return '—';
      return Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10).replace('.', ',');
    };
    return `${fmt(th.min)} M à ${fmt(th.max)} M`;
  }

  function normalizeCoachingException(value) {
    return value === 'never' ? 'never' : 'always';
  }

  function normalizeCoachingContacts(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object') return out;
    Object.keys(raw).forEach((id) => {
      const c = raw[id];
      if (!c || typeof c !== 'object') return;
      out[id] = {
        contacted: Boolean(c.contacted),
        contactedBy: String(c.contactedBy || c.actorLabel || ''),
        contactedAt: String(c.contactedAt || ''),
        actorUserId: String(c.actorUserId || ''),
        actorPlayerId: c.actorPlayerId || null,
        actorLabel: String(c.actorLabel || c.contactedBy || ''),
        tierId: String(c.tierId || ''),
      };
    });
    return out;
  }

  /** Alias historique : joueur sous le seuil héros de Gestion des membres. */
  function isPlayerInCoachingList(player, state) {
    if (!player || player.status !== 'Actif' || player.absent) return false;
    return detectFollowUpReasons(player, state).hero;
  }

  function formatCoachingDateTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const date = d.toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
    const time = d.toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
    });
    return `${date} - ${time}`;
  }

  function getCoachingContact(state, playerId) {
    const contacts = state?.ui?.coachingContacts;
    if (!contacts || typeof contacts !== 'object') return null;
    const row = contacts[playerId];
    if (!row || typeof row !== 'object') return null;
    return row;
  }

  /** État de premier lancement (ou reset) : roster ROS6 prérempli, tous Actifs. */
  function createInitialState() {
    const state = createBlankState();
    const players =
      global.ROSSeed && typeof global.ROSSeed.buildSeedPlayers === 'function'
        ? global.ROSSeed.buildSeedPlayers()
        : [];

    state.players = players;
    // Pas de semaine VS automatique : créée uniquement quand on joue le VS à fond.
    return state;
  }

  function normalizeState(raw) {
    const base = createBlankState();
    if (!raw || typeof raw !== 'object') return createInitialState();

    const powerTiers = normalizePowerTiers(raw.powerTiers);

    const players = Array.isArray(raw.players)
      ? raw.players.map((p) => {
          const heroPowerTierId = migrateHeroPowerTierId(p, powerTiers);
          const player = {
            id: p.id || uid('player'),
            pseudo: String(p.pseudo || '').trim() || 'Sans pseudo',
            role: PLAYER_ROLES.includes(p.role) ? p.role : 'Membre',
            status: PLAYER_STATUSES.includes(p.status) ? p.status : 'Actif',
            absent: Boolean(p.absent),
            inactive: Boolean(p.inactive),
            heroPowerTierId,
            globalPowerTierId: normalizeGlobalPowerTierId(p.globalPowerTierId),
            preferredVolant: Boolean(p.preferredVolant),
            coachingException: normalizeCoachingException(p.coachingException),
            stormAbsencesUnexcused: Math.max(0, Number(p.stormAbsencesUnexcused) || 0),
            stormAbsencesExcused: Math.max(0, Number(p.stormAbsencesExcused) || 0),
            createdAt: p.createdAt || new Date().toISOString(),
            leftAt: p.leftAt || null,
          };
          // Intentions de clear volontaires (sync) — jamais une source métier distante
          if (p.syncClears && typeof p.syncClears === 'object') {
            player.syncClears = { ...p.syncClears };
          }
          return player;
        })
      : [];

    const vsSettings = normalizeVsSettings(raw.vsSettings);
    // WarOps ne suit plus que le VS à fond ; conserve eco.* pour compat historique.
    vsSettings.mode = 'afond';
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
              absent: Boolean(s.absent),
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
      : Array.isArray(raw.weeks)
        ? []
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

    let currentWeekId = raw.currentWeekId || null;
    if (currentWeekId && !weeks.some((w) => w.id === currentWeekId)) {
      currentWeekId = null;
    }
    // Compat : si pas d’id courant mais une seule semaine encore ouverte dans les données
    if (!currentWeekId && weeks.length) {
      const openWeeks = weeks.filter((w) => !w.archived);
      if (openWeeks.length === 1) {
        currentWeekId = openWeeks[0].id;
      } else if (openWeeks.length > 1) {
        currentWeekId = openWeeks[0].id;
      }
      // Si toutes sont archivées → currentWeekId reste null (aucune active)
    }

    // Politique WarOps : pas d’historique VS/dons — uniquement la semaine active éventuelle.
    if (currentWeekId) {
      weeks = weeks
        .filter((week) => week.id === currentWeekId)
        .map((week) => {
          week.archived = false;
          return week;
        });
    } else {
      weeks = [];
    }

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
    const coachingContacts = normalizeCoachingContacts(rawUi.coachingContacts);

    const weekIds = new Set(weeks.map((w) => w.id));
    const rawNotes =
      raw.playerWeekNotes && typeof raw.playerWeekNotes === 'object' ? raw.playerWeekNotes : {};
    const playerWeekNotes = {};
    Object.keys(rawNotes).forEach((playerId) => {
      const byWeek = rawNotes[playerId];
      if (!byWeek || typeof byWeek !== 'object') return;
      const kept = {};
      Object.keys(byWeek).forEach((weekId) => {
        if (weekIds.has(weekId)) kept[weekId] = byWeek[weekId];
      });
      if (Object.keys(kept).length) playerWeekNotes[playerId] = kept;
    });

    const coachingThreshold = normalizeCoachingThreshold(raw.coachingThreshold);
    const followUpSettings = normalizeFollowUpSettings(raw.followUpSettings);
    const playerFollowUps = normalizePlayerFollowUps(raw.playerFollowUps);
    const playerVsUnderStats = normalizePlayerVsUnderStats(raw.playerVsUnderStats);
    const alliance = normalizeAllianceSettings(raw.alliance);

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
      coachingThreshold,
      followUpSettings,
      playerFollowUps,
      playerVsUnderStats,
      alliance,
      globalPowerAudit: normalizeGlobalPowerAudit(raw.globalPowerAudit),
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
    isScoreAbsent,
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
    countHighDays,
    isPraiseWeekScore,
    createDefaultPowerTiers,
    normalizePowerTier,
    normalizePowerTiers,
    getSortedPowerTiers,
    getPowerTiers,
    getPowerTierById,
    getPlayerPowerTier,
    getPlayerPowerSortValue,
    getPlayerPowerLabel,
    getHeroPowerRepresentativeValue,
    countPlayersUsingPowerTier,
    buildPowerTierSelectOptions,
    getGlobalPowerTiers,
    normalizeGlobalPowerTierId,
    getGlobalPowerTierById,
    getPlayerGlobalPowerTier,
    getPlayerGlobalPowerLabel,
    getPlayerGlobalPowerSortValue,
    getGlobalPowerRepresentativeValue,
    buildGlobalPowerSelectOptions,
    hasCompletePowerData,
    buildCompositePowerScoreMap,
    getPlayerCompositePowerScore,
    canEditGlobalPower,
    createDefaultCoachingThreshold,
    normalizeCoachingThreshold,
    getCoachingThreshold,
    formatCoachingThresholdLabel,
    normalizeCoachingException,
    normalizeCoachingContacts,
    isPlayerInCoachingList,
    formatCoachingDateTime,
    getCoachingContact,
    createDefaultFollowUpSettings,
    normalizeFollowUpSettings,
    getFollowUpSettings,
    FOLLOW_UP_STATUSES,
    FOLLOW_UP_SPECIALIST_KEYS,
    emptyFollowUpSpecialists,
    normalizeFollowUpSpecialists,
    getFollowUpSpecialistKeysForPlayer,
    pickFollowUpSpecialist,
    isFollowUpVisibleToViewer,
    normalizeFollowUpStatus,
    getFollowUpStatusLabel,
    createEmptyFollowUpCase,
    normalizeFollowUpCase,
    normalizePlayerFollowUps,
    getFollowUpReferenceWeek,
    countPlayerVsUnderDays,
    detectFollowUpReasons,
    formatFollowUpReasonsLabel,
    VS_UNDER_HISTORY_LIMIT,
    normalizePlayerVsUnderStats,
    getPlayerVsUnderStats,
    summarizeVsUnderStats,
    formatVsUnderCounterLabel,
    formatVsPraiseCounterLabel,
    recordVsUnderSnapshotsForWeek,
    emptyFollowUpReasons,
    createDefaultAllianceSettings,
    normalizeAllianceSettings,
    getAllianceSettings,
    getAllianceName,
    getAllianceTag,
    createBlankState,
    createBlankUiState,
    createInitialState,
    normalizeState,
    normalizeGlobalPowerAudit,
    canReset,
    canImportOverwrite,
  };
})(window);
