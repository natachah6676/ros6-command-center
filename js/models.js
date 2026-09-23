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

  /**
   * Signal VS pour la ligne : félicitations ou coaching (exclusifs).
   * @returns {'praise'|'coach'|null}
   */
  function getVsWeekSignal(score, state) {
    if (!score || isScoreAbsent(score)) return null;
    if (isPraiseWeekScore(score, state)) return 'praise';
    const underDays = countDaysUnderObjective(score);
    const minUnder = getFollowUpSettings(state).vsMinUnderDays;
    if (underDays >= minUnder) return 'coach';
    return null;
  }

  function normalizeVsWeekContact(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const kind = raw.kind === 'praise' || raw.kind === 'coach' ? raw.kind : null;
    if (!kind) return null;
    return {
      kind,
      at: raw.at ? String(raw.at) : new Date().toISOString(),
      authorLabel: raw.authorLabel != null ? String(raw.authorLabel) : '',
      authorUserId: raw.authorUserId != null ? String(raw.authorUserId) : '',
    };
  }

  function normalizeVsWeekContacts(raw) {
    if (!raw || typeof raw !== 'object') return {};
    const out = {};
    Object.keys(raw).forEach((playerId) => {
      if (!playerId) return;
      const contact = normalizeVsWeekContact(raw[playerId]);
      if (contact) out[playerId] = contact;
    });
    return out;
  }

  const VS_UNDER_WEEK_HISTORY_LIMIT = 12;
  /** Journal create/close VS — ~1 an d’activité hebdo, payload négligeable. */
  const VS_WEEK_AUDIT_LIMIT = 100;
  const VS_WEEK_AUDIT_ACTIONS = ['create', 'close'];

  function normalizeVsUnderWeekHistoryEntry(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const weekId = raw.weekId ? String(raw.weekId) : '';
    if (!weekId) return null;
    const players = Array.isArray(raw.players)
      ? raw.players
          .filter((p) => p && p.playerId)
          .map((p) => ({
            playerId: String(p.playerId),
            pseudo: String(p.pseudo || '').trim() || 'Sans pseudo',
            underDays: Math.max(0, Number(p.underDays) || 0),
            contacted: Boolean(p.contacted),
            contactedAt: p.contactedAt || null,
            contactedBy: p.contactedBy != null ? String(p.contactedBy) : '',
          }))
      : [];
    return {
      weekId,
      weekLabel: raw.weekLabel != null ? String(raw.weekLabel) : '',
      startDate: raw.startDate || '',
      endDate: raw.endDate || '',
      closedAt: raw.closedAt || null,
      createdAt: raw.createdAt || null,
      createdBy: raw.createdBy != null ? String(raw.createdBy) : '',
      createdByUserId: raw.createdByUserId != null ? String(raw.createdByUserId) : '',
      createdByPlayerId: raw.createdByPlayerId || null,
      closedBy: raw.closedBy != null ? String(raw.closedBy) : '',
      closedByUserId: raw.closedByUserId != null ? String(raw.closedByUserId) : '',
      closedByPlayerId: raw.closedByPlayerId || null,
      underMinDays: Math.max(1, Number(raw.underMinDays) || 2),
      players,
    };
  }

  function normalizeVsUnderWeekHistory(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
      .map(normalizeVsUnderWeekHistoryEntry)
      .filter(Boolean)
      .slice(0, VS_UNDER_WEEK_HISTORY_LIMIT);
  }

  function normalizeVsWeekAuditEntry(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const action = String(raw.action || '').trim();
    if (!VS_WEEK_AUDIT_ACTIONS.includes(action)) return null;
    const weekId = raw.weekId != null ? String(raw.weekId).trim() : '';
    if (!weekId) return null;
    const id = raw.id != null ? String(raw.id).trim() : '';
    if (!id) return null;
    return {
      id,
      action,
      weekId,
      startDate: raw.startDate != null ? String(raw.startDate) : '',
      label: raw.label != null ? String(raw.label) : '',
      at: raw.at || null,
      actorUserId: raw.actorUserId != null ? String(raw.actorUserId) : '',
      actorPlayerId: raw.actorPlayerId || null,
      actorLabel: raw.actorLabel != null ? String(raw.actorLabel) : '',
    };
  }

  function normalizeVsWeekAudit(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
      .map(normalizeVsWeekAuditEntry)
      .filter(Boolean)
      .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
      .slice(0, VS_WEEK_AUDIT_LIMIT);
  }

  function preferNonEmptyAuditField(preferred, fallback) {
    if (preferred != null && String(preferred).trim() !== '') return preferred;
    if (fallback != null && String(fallback).trim() !== '') return fallback;
    return preferred != null ? preferred : fallback;
  }

  function mergeVsWeekAuditEntries(remoteEntry, localEntry) {
    if (!remoteEntry) return localEntry ? { ...localEntry } : null;
    if (!localEntry) return { ...remoteEntry };
    return {
      id: remoteEntry.id || localEntry.id,
      action: remoteEntry.action || localEntry.action,
      weekId: remoteEntry.weekId || localEntry.weekId,
      startDate: preferNonEmptyAuditField(localEntry.startDate, remoteEntry.startDate) || '',
      label: preferNonEmptyAuditField(localEntry.label, remoteEntry.label) || '',
      at: preferNonEmptyAuditField(remoteEntry.at, localEntry.at) || null,
      actorUserId: preferNonEmptyAuditField(remoteEntry.actorUserId, localEntry.actorUserId) || '',
      actorPlayerId: preferNonEmptyAuditField(remoteEntry.actorPlayerId, localEntry.actorPlayerId),
      actorLabel: preferNonEmptyAuditField(remoteEntry.actorLabel, localEntry.actorLabel) || '',
    };
  }

  /**
   * Fusion sync du journal VS : union par id, puis plafond chronologique.
   * N’invente jamais d’acteur manquant.
   */
  function mergeVsWeekAudits(remoteAudit, localAudit) {
    const remote = normalizeVsWeekAudit(remoteAudit);
    const local = normalizeVsWeekAudit(localAudit);
    const byId = new Map();
    remote.forEach((entry) => {
      byId.set(entry.id, entry);
    });
    local.forEach((entry) => {
      byId.set(entry.id, mergeVsWeekAuditEntries(byId.get(entry.id), entry));
    });
    return [...byId.values()]
      .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
      .slice(0, VS_WEEK_AUDIT_LIMIT);
  }

  function buildVsWeekAuditEntry(action, week, actor, atOverride) {
    if (!week?.id || !VS_WEEK_AUDIT_ACTIONS.includes(action)) return null;
    const actorSafe = actor && typeof actor === 'object' ? actor : {};
    return {
      id: uid('vsaudit'),
      action,
      weekId: String(week.id),
      startDate: week.startDate || '',
      label: week.label || `Semaine ${week.number || ''}`.trim(),
      at: atOverride || week.createdAt || week.closedAt || new Date().toISOString(),
      actorUserId: actorSafe.actorUserId != null ? String(actorSafe.actorUserId) : '',
      actorPlayerId: actorSafe.actorPlayerId || null,
      actorLabel: actorSafe.actorLabel != null ? String(actorSafe.actorLabel) : '',
    };
  }

  function pushVsWeekAudit(state, entry) {
    if (!state || !entry) return state;
    const normalized = normalizeVsWeekAuditEntry(entry);
    if (!normalized) return state;
    const prev = normalizeVsWeekAudit(state.vsWeekAudit).filter((e) => e.id !== normalized.id);
    state.vsWeekAudit = [normalized, ...prev]
      .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
      .slice(0, VS_WEEK_AUDIT_LIMIT);
    return state;
  }

  /**
   * Archive légère à la clôture : uniquement les joueurs sous seuil (≥ vsMinUnderDays).
   * Copie createdBy* / closedBy* depuis la semaine si présents — jamais inventés.
   */
  function pushVsUnderWeekArchive(state, week) {
    if (!state || !week) return state;
    const settings = getFollowUpSettings(state);
    if (settings.vsFollowUpMutedWeekId && week.id === settings.vsFollowUpMutedWeekId) {
      return state;
    }
    const contacts = normalizeVsWeekContacts(week.vsContacts);
    const underMin = settings.vsMinUnderDays;
    const players = [];
    (state.players || []).forEach((player) => {
      if (!player || player.status !== 'Actif' || player.absent) return;
      const score = week.scores?.[player.id];
      if (!score || isScoreAbsent(score)) return;
      const underDays = countDaysUnderObjective(score);
      if (underDays < underMin) return;
      const contact = contacts[player.id];
      const contacted = Boolean(contact && contact.kind === 'coach');
      players.push({
        playerId: player.id,
        pseudo: player.pseudo,
        underDays,
        contacted,
        contactedAt: contacted ? contact.at : null,
        contactedBy: contacted ? contact.authorLabel || '' : '',
      });
    });
    players.sort((a, b) => a.pseudo.localeCompare(b.pseudo, 'fr', { sensitivity: 'base' }));
    const entry = {
      weekId: week.id,
      weekLabel: week.label || `Semaine ${week.number || ''}`.trim(),
      startDate: week.startDate || '',
      endDate: week.endDate || '',
      closedAt: week.closedAt || new Date().toISOString(),
      createdAt: week.createdAt || null,
      createdBy: week.createdBy != null ? String(week.createdBy) : '',
      createdByUserId: week.createdByUserId != null ? String(week.createdByUserId) : '',
      createdByPlayerId: week.createdByPlayerId || null,
      closedBy: week.closedBy != null ? String(week.closedBy) : '',
      closedByUserId: week.closedByUserId != null ? String(week.closedByUserId) : '',
      closedByPlayerId: week.closedByPlayerId || null,
      underMinDays: underMin,
      players,
    };
    const prev = normalizeVsUnderWeekHistory(state.vsUnderWeekHistory).filter(
      (e) => e.weekId !== week.id
    );
    state.vsUnderWeekHistory = [entry, ...prev].slice(0, VS_UNDER_WEEK_HISTORY_LIMIT);
    return state;
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
    const actor = options.actor && typeof options.actor === 'object' ? options.actor : null;

    return {
      id: uid('week'),
      number,
      label: `Semaine ${number}`,
      startDate,
      endDate,
      createdAt: new Date().toISOString(),
      createdBy: actor?.actorLabel != null ? String(actor.actorLabel) : '',
      createdByUserId: actor?.actorUserId != null ? String(actor.actorUserId) : '',
      createdByPlayerId: actor?.actorPlayerId || null,
      archived: Boolean(options.archived),
      donationsVerified: false,
      scores: {},
      /** Contacts coaching / félicitations de la semaine active. */
      vsContacts: {},
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
    discret = false,
    inactive = false,
    heroPowerTierId = null,
    preferredVolant = false,
    coachingException = 'always',
  }) {
    return {
      id: uid('player'),
      pseudo: String(pseudo || '').trim(),
      role,
      status,
      absent: Boolean(absent),
      /** Discret mais fort : prise de nouvelles dans Liste des membres (pas Gestion des membres). */
      discret: Boolean(discret),
      inactive: Boolean(inactive),
      heroPowerTierId: heroPowerTierId ? String(heroPowerTierId) : null,
      preferredVolant: Boolean(preferredVolant),
      coachingException: coachingException === 'never' ? 'never' : 'always',
      stormAbsencesUnexcused: 0,
      stormAbsencesExcused: 0,
      discretContacts: [],
      createdAt: new Date().toISOString(),
      leftAt: status === 'Parti' ? new Date().toISOString() : null,
    };
  }

  const DISCRET_CONTACT_HISTORY_LIMIT = 100;
  const DISCRET_CONTACT_OVERDUE_DAYS = 30;

  function normalizeDiscretContact(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const at = raw.at ? String(raw.at) : '';
    if (!at) return null;
    return {
      id: raw.id || uid('dcontact'),
      at,
      text: raw.text != null ? String(raw.text).trim() : '',
      authorLabel: raw.authorLabel != null ? String(raw.authorLabel) : '',
      authorUserId: raw.authorUserId != null ? String(raw.authorUserId) : '',
    };
  }

  function normalizeDiscretContacts(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
      .map(normalizeDiscretContact)
      .filter(Boolean)
      .sort((a, b) => (a.at < b.at ? 1 : -1))
      .slice(0, DISCRET_CONTACT_HISTORY_LIMIT);
  }

  function getLastDiscretContactAt(player) {
    const contacts = normalizeDiscretContacts(player?.discretContacts);
    return contacts[0]?.at || null;
  }

  function isDiscretContactOverdue(player, days = DISCRET_CONTACT_OVERDUE_DAYS, now = new Date()) {
    if (!player?.discret) return false;
    const last = getLastDiscretContactAt(player);
    if (!last) return true;
    const at = new Date(last);
    if (Number.isNaN(at.getTime())) return true;
    const ms = Math.max(1, Number(days) || DISCRET_CONTACT_OVERDUE_DAYS) * 24 * 60 * 60 * 1000;
    return now.getTime() - at.getTime() >= ms;
  }

  function pushDiscretContact(player, entry = {}) {
    if (!player || typeof player !== 'object') return null;
    const contact = normalizeDiscretContact({
      id: entry.id || uid('dcontact'),
      at: entry.at || new Date().toISOString(),
      text: entry.text != null ? entry.text : 'Contact pris',
      authorLabel: entry.authorLabel,
      authorUserId: entry.authorUserId,
    });
    if (!contact) return null;
    player.discretContacts = normalizeDiscretContacts([contact, ...(player.discretContacts || [])]);
    return contact;
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
      /** Historique permanent des commentaires de suivi (par joueur, append-only). */
      playerFollowUpNotes: {},
      /** Compteur léger VS sous seuil (fenêtre glissante, sans garder les semaines). */
      playerVsUnderStats: {},
      /** Résumés « sous seuil » des semaines clôturées (consultation Semaines passées). */
      vsUnderWeekHistory: [],
      /** Journal permanent create/close des semaines VS (plafond VS_WEEK_AUDIT_LIMIT). */
      vsWeekAudit: [],
      /**
       * Lifecycle sync VS : closeIntent distingue une clôture volontaire
       * d’un cache local vide (anti-écrasement / anti-résurrection).
       */
      vsWeekLifecycle: {},
      alliance: createDefaultAllianceSettings(),
    };
  }

  function normalizeVsWeekLifecycle(raw) {
    if (!raw || typeof raw !== 'object') return {};
    const intent = raw.closeIntent;
    if (!intent || typeof intent !== 'object') return {};
    const weekId = intent.weekId != null ? String(intent.weekId).trim() : '';
    if (!weekId) return {};
    return {
      closeIntent: {
        weekId,
        closedAt: intent.closedAt || null,
      },
    };
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
      /**
       * Après « Remettre les compteurs VS à zéro » : ignore VS / félicitations
       * pour cette semaine de référence (jusqu’à une nouvelle semaine).
       */
      vsFollowUpMutedWeekId: null,
    };
  }

  const FOLLOW_UP_SPECIALIST_KEYS = [
    { id: 'vs', label: 'VS sous seuil' },
    { id: 'praise', label: 'À féliciter' },
    { id: 'hero', label: 'Puissance héros' },
    { id: 'discret', label: 'Discret' },
    { id: 'manual', label: 'Aide / manuel' },
  ];

  function emptyFollowUpSpecialists(seed = {}) {
    return {
      vs: seed.vs || null,
      praise: seed.praise || null,
      hero: seed.hero || null,
      discret: seed.discret || null,
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
    const mutedWeek =
      raw?.vsFollowUpMutedWeekId != null && String(raw.vsFollowUpMutedWeekId).trim()
        ? String(raw.vsFollowUpMutedWeekId).trim()
        : null;
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
      vsFollowUpMutedWeekId: mutedWeek,
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
   * Choisit un référent selon les motifs actifs (priorité VS → féliciter → héros → discret → manuel).
   */
  function pickFollowUpSpecialist(reasons, state) {
    const settings = getFollowUpSettings(state);
    const specs = settings.specialists || emptyFollowUpSpecialists();
    const priority = ['vs', 'praise', 'hero', 'discret', 'manual'];
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
      discret: Boolean(seed.discret),
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
      closeReason: normalizeFollowUpCloseReason(options.closeReason),
    };
  }

  function normalizeFollowUpNote(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const deletedAt = raw.deletedAt ? String(raw.deletedAt) : '';
    const text = String(raw.text || '').trim();
    // Tombstone : conservé même sans texte ; note vivante : texte obligatoire.
    if (!text && !deletedAt) return null;
    const note = {
      id: raw.id || uid('funote'),
      at: raw.at || new Date().toISOString(),
      text: text || '',
      authorLabel: raw.authorLabel != null ? String(raw.authorLabel) : '',
      authorUserId: raw.authorUserId != null ? String(raw.authorUserId) : '',
    };
    if (raw.updatedAt) {
      note.updatedAt = String(raw.updatedAt);
      note.updatedByUserId =
        raw.updatedByUserId != null ? String(raw.updatedByUserId) : '';
      note.updatedByLabel =
        raw.updatedByLabel != null ? String(raw.updatedByLabel) : '';
    }
    if (deletedAt) {
      note.deletedAt = deletedAt;
      note.deletedByUserId =
        raw.deletedByUserId != null ? String(raw.deletedByUserId) : '';
      note.deletedByLabel =
        raw.deletedByLabel != null ? String(raw.deletedByLabel) : '';
    }
    return note;
  }

  function isFollowUpNoteDeleted(note) {
    return Boolean(note && note.deletedAt);
  }

  /**
   * Fusion multi-appareils par `id` :
   * - tombstone (deletedAt) gagne toujours sur une copie vivante ;
   * - sinon la version avec updatedAt / at la plus récente pour le texte ;
   * - at + auteur d’origine conservés.
   * Aucun plafond.
   */
  function mergeFollowUpNotesArrays(a, b) {
    const map = new Map();
    const pickMerged = (prev, next) => {
      if (!prev) return next;
      if (!next) return prev;
      const prevDel = isFollowUpNoteDeleted(prev);
      const nextDel = isFollowUpNoteDeleted(next);
      if (prevDel || nextDel) {
        const tomb = nextDel && prevDel
          ? String(prev.deletedAt) <= String(next.deletedAt)
            ? prev
            : next
          : prevDel
            ? prev
            : next;
        return {
          id: prev.id || next.id,
          at:
            String(prev.at || '') && String(next.at || '')
              ? String(prev.at) <= String(next.at)
                ? prev.at
                : next.at
              : prev.at || next.at,
          text: tomb.text || prev.text || next.text || '',
          authorLabel: prev.authorLabel || next.authorLabel || '',
          authorUserId: prev.authorUserId || next.authorUserId || '',
          deletedAt: tomb.deletedAt,
          deletedByUserId: tomb.deletedByUserId || '',
          deletedByLabel: tomb.deletedByLabel || '',
          ...(prev.updatedAt || next.updatedAt
            ? {
                updatedAt:
                  String(prev.updatedAt || '') >= String(next.updatedAt || '')
                    ? prev.updatedAt || next.updatedAt
                    : next.updatedAt || prev.updatedAt,
                updatedByUserId:
                  String(prev.updatedAt || '') >= String(next.updatedAt || '')
                    ? prev.updatedByUserId || next.updatedByUserId || ''
                    : next.updatedByUserId || prev.updatedByUserId || '',
                updatedByLabel:
                  String(prev.updatedAt || '') >= String(next.updatedAt || '')
                    ? prev.updatedByLabel || next.updatedByLabel || ''
                    : next.updatedByLabel || prev.updatedByLabel || '',
              }
            : {}),
        };
      }
      const prevTouch = String(prev.updatedAt || prev.at || '');
      const nextTouch = String(next.updatedAt || next.at || '');
      const newer = nextTouch >= prevTouch ? next : prev;
      const older = newer === next ? prev : next;
      const out = {
        id: prev.id || next.id,
        at:
          String(prev.at || '') && String(next.at || '')
            ? String(prev.at) <= String(next.at)
              ? prev.at
              : next.at
            : prev.at || next.at,
        text: newer.text || older.text || '',
        authorLabel: older.authorLabel || newer.authorLabel || '',
        authorUserId: older.authorUserId || newer.authorUserId || '',
      };
      if (newer.updatedAt || older.updatedAt) {
        const uNewer =
          String(newer.updatedAt || '') >= String(older.updatedAt || '') ? newer : older;
        out.updatedAt = uNewer.updatedAt;
        out.updatedByUserId = uNewer.updatedByUserId || '';
        out.updatedByLabel = uNewer.updatedByLabel || '';
      }
      return out;
    };

    const ingest = (list) => {
      (Array.isArray(list) ? list : []).forEach((raw) => {
        const note = normalizeFollowUpNote(raw);
        if (!note) return;
        map.set(note.id, pickMerged(map.get(note.id), note));
      });
    };
    ingest(a);
    ingest(b);
    return [...map.values()].sort((x, y) => {
      const ax = String(x.at || '');
      const ay = String(y.at || '');
      if (ax !== ay) return ax < ay ? -1 : 1;
      return String(x.id).localeCompare(String(y.id));
    });
  }

  function normalizePlayerFollowUpNotesLedger(raw) {
    if (!raw || typeof raw !== 'object') return {};
    const out = {};
    Object.keys(raw).forEach((playerId) => {
      if (!playerId) return;
      const row = raw[playerId];
      const notes = Array.isArray(row)
        ? mergeFollowUpNotesArrays(row, [])
        : mergeFollowUpNotesArrays(row?.notes, []);
      out[playerId] = { notes };
    });
    return out;
  }

  /** Notes visibles UI (hors tombstones). */
  function getPlayerFollowUpNotes(state, playerId, options = {}) {
    if (!playerId) return [];
    const row = state?.playerFollowUpNotes?.[playerId];
    if (!row) return [];
    const all = mergeFollowUpNotesArrays(row.notes, []);
    if (options.includeDeleted) return all;
    return all.filter((n) => !isFollowUpNoteDeleted(n));
  }

  /**
   * Copie non destructive des notes legacy (fiches) vers le ledger permanent.
   * Ne supprime jamais playerFollowUps[*].notes.
   * Un tombstone ledger gagne toujours sur une copie legacy vivante (même id).
   */
  function migrateFollowUpNotesFromCases(state) {
    if (!state || typeof state !== 'object') return state;
    if (!state.playerFollowUpNotes || typeof state.playerFollowUpNotes !== 'object') {
      state.playerFollowUpNotes = {};
    }
    const cases = state.playerFollowUps || {};
    Object.keys(cases).forEach((playerId) => {
      const legacyNotes = cases[playerId]?.notes;
      if (!Array.isArray(legacyNotes) || !legacyNotes.length) return;
      const existing = state.playerFollowUpNotes[playerId]?.notes || [];
      const merged = mergeFollowUpNotesArrays(existing, legacyNotes);
      state.playerFollowUpNotes[playerId] = { notes: merged };
    });
    return state;
  }

  function appendPlayerFollowUpNote(state, playerId, entry = {}) {
    if (!state || !playerId) return null;
    if (!state.playerFollowUpNotes || typeof state.playerFollowUpNotes !== 'object') {
      state.playerFollowUpNotes = {};
    }
    const note = normalizeFollowUpNote({
      id: entry.id || uid('funote'),
      at: entry.at || new Date().toISOString(),
      text: entry.text,
      authorLabel: entry.authorLabel,
      authorUserId: entry.authorUserId,
    });
    if (!note || isFollowUpNoteDeleted(note)) return null;
    const prev = state.playerFollowUpNotes[playerId]?.notes || [];
    state.playerFollowUpNotes[playerId] = {
      notes: mergeFollowUpNotesArrays(prev, [note]),
    };
    return note;
  }

  /**
   * R5 : tous les commentaires.
   * R4 : uniquement si ce R4 est « Qui suit » (assigneePlayerId) sur la fiche du joueur.
   */
  function canMutatePlayerFollowUpNotes(state, playerId, viewer = {}) {
    if (!playerId) return false;
    if (viewer.isR5) return true;
    if (!viewer.isR4OrR5 && !viewer.viewerPlayerId) return false;
    const follow = state?.playerFollowUps?.[playerId];
    const assignee = follow?.assigneePlayerId ? String(follow.assigneePlayerId) : '';
    const me = viewer.viewerPlayerId ? String(viewer.viewerPlayerId) : '';
    return Boolean(me && assignee && me === assignee);
  }

  function updatePlayerFollowUpNote(state, playerId, noteId, { text, actor } = {}) {
    if (!state || !playerId || !noteId) return null;
    const clean = String(text || '').trim();
    if (!clean) return null;
    const all = getPlayerFollowUpNotes(state, playerId, { includeDeleted: true });
    const current = all.find((n) => n.id === noteId);
    if (!current || isFollowUpNoteDeleted(current)) return null;
    const updated = normalizeFollowUpNote({
      ...current,
      text: clean,
      updatedAt: new Date().toISOString(),
      updatedByUserId: actor?.actorUserId || '',
      updatedByLabel: actor?.actorLabel || '',
    });
    if (!updated) return null;
    state.playerFollowUpNotes = state.playerFollowUpNotes || {};
    state.playerFollowUpNotes[playerId] = {
      notes: mergeFollowUpNotesArrays(
        all.filter((n) => n.id !== noteId),
        [updated]
      ),
    };
    // Miroir compat fiche
    const row = state.playerFollowUps?.[playerId];
    if (row && Array.isArray(row.notes)) {
      row.notes = mergeFollowUpNotesArrays(row.notes, [updated]);
    }
    return updated;
  }

  function softDeletePlayerFollowUpNote(state, playerId, noteId, { actor } = {}) {
    if (!state || !playerId || !noteId) return null;
    const all = getPlayerFollowUpNotes(state, playerId, { includeDeleted: true });
    const current = all.find((n) => n.id === noteId);
    if (!current) return null;
    if (isFollowUpNoteDeleted(current)) return current;
    const tomb = {
      id: current.id,
      at: current.at,
      text: current.text || '(supprimé)',
      authorLabel: current.authorLabel || '',
      authorUserId: current.authorUserId || '',
      deletedAt: new Date().toISOString(),
      deletedByUserId: actor?.actorUserId || '',
      deletedByLabel: actor?.actorLabel || '',
    };
    if (current.updatedAt) {
      tomb.updatedAt = current.updatedAt;
      tomb.updatedByUserId = current.updatedByUserId || '';
      tomb.updatedByLabel = current.updatedByLabel || '';
    }
    state.playerFollowUpNotes = state.playerFollowUpNotes || {};
    state.playerFollowUpNotes[playerId] = {
      notes: mergeFollowUpNotesArrays(
        all.filter((n) => n.id !== noteId),
        [tomb]
      ),
    };
    const row = state.playerFollowUps?.[playerId];
    if (row && Array.isArray(row.notes)) {
      row.notes = mergeFollowUpNotesArrays(row.notes, [tomb]);
    }
    return tomb;
  }

  /**
   * Fusion sync du ledger permanent : union des joueurs, union des notes par id.
   * Tombstone gagne toujours — un cache ancien ne restaure pas une note supprimée.
   */
  function mergePlayerFollowUpNotesLedgers(remoteLedger, localLedger) {
    const remote = normalizePlayerFollowUpNotesLedger(remoteLedger);
    const local = normalizePlayerFollowUpNotesLedger(localLedger);
    const ids = new Set([...Object.keys(remote), ...Object.keys(local)]);
    const out = {};
    ids.forEach((playerId) => {
      const merged = mergeFollowUpNotesArrays(
        remote[playerId]?.notes,
        local[playerId]?.notes
      );
      out[playerId] = { notes: merged };
    });
    return out;
  }

  function normalizeFollowUpCase(raw) {
    if (!raw || typeof raw !== 'object') return createEmptyFollowUpCase();
    // Compat ancienne structure : plafond 200 conservé uniquement ici.
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
      closeReason: normalizeFollowUpCloseReason(raw.closeReason),
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

    const existing = state?.playerFollowUps?.[player.id];
    if (existing?.manual || existing?.reasons?.manual) reasons.manual = true;
    // VS / À féliciter : hors Gestion des membres pour l’instant (prévu onglet VS).
    // Discret : Liste des membres uniquement.

    // Absent = hors détection héros auto.
    if (player.absent) return reasons;

    const heroSort = getPlayerPowerSortValue(player, state);
    if (heroSort >= 0 && heroSort <= settings.heroMaxM) {
      reasons.hero = true;
    }

    return reasons;
  }

  const FOLLOW_UP_CLOSE_REASONS = [
    { id: 'not_interested', label: "N'est pas intéressé" },
    { id: 'no_reply', label: 'Ne répond pas' },
    { id: 'coaching_done', label: 'Coaching terminé' },
  ];

  function normalizeFollowUpCloseReason(value) {
    const id = String(value || '').trim();
    return FOLLOW_UP_CLOSE_REASONS.some((r) => r.id === id) ? id : null;
  }

  function getFollowUpCloseReasonLabel(reasonId) {
    return FOLLOW_UP_CLOSE_REASONS.find((r) => r.id === reasonId)?.label || '';
  }

  function formatFollowUpReasonsLabel(reasons) {
    const parts = [];
    if (reasons?.vs) parts.push('VS sous seuil');
    if (reasons?.praise) parts.push('À féliciter');
    if (reasons?.hero) parts.push('Puissance héros');
    if (reasons?.discret) parts.push('Discret');
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
    const { underCount } = summarizeVsUnderStats(stats);
    return `VS Sous Seuil : ${underCount}`;
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
    // Reset compteurs : ne pas réécrire d’historique pour la semaine muette.
    if (settings.vsFollowUpMutedWeekId && week.id === settings.vsFollowUpMutedWeekId) {
      return state;
    }
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
      // Ne mémorise que les semaines « utiles » (sous seuil ou à féliciter).
      if (!under && !praise) return;
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
            discret: Boolean(p.discret),
            inactive: Boolean(p.inactive),
            heroPowerTierId,
            preferredVolant: Boolean(p.preferredVolant),
            coachingException: normalizeCoachingException(p.coachingException),
            stormAbsencesUnexcused: Math.max(0, Number(p.stormAbsencesUnexcused) || 0),
            stormAbsencesExcused: Math.max(0, Number(p.stormAbsencesExcused) || 0),
            discretContacts: normalizeDiscretContacts(p.discretContacts),
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
            // Pas d’invention d’auteur pour les semaines historiques.
            createdBy: w.createdBy != null ? String(w.createdBy) : '',
            createdByUserId: w.createdByUserId != null ? String(w.createdByUserId) : '',
            createdByPlayerId: w.createdByPlayerId || null,
            archived: Boolean(w.archived),
            closedAt: w.closedAt || null,
            closedBy: w.closedBy || '',
            closedByUserId: w.closedByUserId || '',
            closedByPlayerId: w.closedByPlayerId || null,
            donationsVerified: Boolean(w.donationsVerified),
            scores,
            vsContacts: normalizeVsWeekContacts(w.vsContacts),
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
    const playerFollowUpNotes = normalizePlayerFollowUpNotesLedger(raw.playerFollowUpNotes);
    const playerVsUnderStats = normalizePlayerVsUnderStats(raw.playerVsUnderStats);
    const vsUnderWeekHistory = normalizeVsUnderWeekHistory(raw.vsUnderWeekHistory);
    const vsWeekAudit = normalizeVsWeekAudit(raw.vsWeekAudit);
    const vsWeekLifecycle = normalizeVsWeekLifecycle(raw.vsWeekLifecycle);
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
      playerFollowUpNotes,
      playerVsUnderStats,
      vsUnderWeekHistory,
      vsWeekAudit,
      vsWeekLifecycle,
      alliance,
    };

    // Compatibilité : anciennes clés « pseudo » → identifiant interne
    if (global.ROSPlayerIdentity && typeof global.ROSPlayerIdentity.migrateMainState === 'function') {
      global.ROSPlayerIdentity.migrateMainState(normalized);
    }

    // Copie non destructive des notes legacy → ledger permanent (après remap d’identité).
    migrateFollowUpNotesFromCases(normalized);

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
    DISCRET_CONTACT_HISTORY_LIMIT,
    DISCRET_CONTACT_OVERDUE_DAYS,
    normalizeDiscretContact,
    normalizeDiscretContacts,
    getLastDiscretContactAt,
    isDiscretContactOverdue,
    pushDiscretContact,
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
    getVsWeekSignal,
    normalizeVsWeekContact,
    normalizeVsWeekContacts,
    VS_UNDER_WEEK_HISTORY_LIMIT,
    VS_WEEK_AUDIT_LIMIT,
    VS_WEEK_AUDIT_ACTIONS,
    normalizeVsUnderWeekHistory,
    normalizeVsWeekAudit,
    normalizeVsWeekAuditEntry,
    mergeVsWeekAudits,
    buildVsWeekAuditEntry,
    pushVsWeekAudit,
    normalizeVsWeekLifecycle,
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
    normalizeFollowUpNote,
    normalizePlayerFollowUps,
    normalizePlayerFollowUpNotesLedger,
    getPlayerFollowUpNotes,
    isFollowUpNoteDeleted,
    mergeFollowUpNotesArrays,
    mergePlayerFollowUpNotesLedgers,
    migrateFollowUpNotesFromCases,
    appendPlayerFollowUpNote,
    canMutatePlayerFollowUpNotes,
    updatePlayerFollowUpNote,
    softDeletePlayerFollowUpNote,
    getFollowUpReferenceWeek,
    countPlayerVsUnderDays,
    detectFollowUpReasons,
    formatFollowUpReasonsLabel,
    FOLLOW_UP_CLOSE_REASONS,
    normalizeFollowUpCloseReason,
    getFollowUpCloseReasonLabel,
    VS_UNDER_HISTORY_LIMIT,
    normalizePlayerVsUnderStats,
    getPlayerVsUnderStats,
    summarizeVsUnderStats,
    formatVsUnderCounterLabel,
    formatVsPraiseCounterLabel,
    recordVsUnderSnapshotsForWeek,
    pushVsUnderWeekArchive,
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
    canReset,
    canImportOverwrite,
  };
})(window);
