/**
 * Module Recrutement — joueurs à remplacer (score sur historique VS archivé).
 * Critères fixes (Inactif, Coaching) + agrégation cumulative VS / Dons.
 */
(function (global) {
  const POINTS = {
    vs: { green: 0, orange: 5, red: 10 },
    donations: { green: 0, orange: 5, red: 10 },
    inactive: 40,
    coaching: 10,
  };

  /** Score minimum pour apparaître dans la liste. */
  const MIN_SCORE = 15;

  /**
   * Critères ponctuels (hors historique hebdo) — extensibles.
   * Chaque entrée : { id, label, points, matches(player, state) }
   */
  const RECRUITMENT_CRITERIA = [
    {
      id: 'inactive',
      label: 'Inactif',
      points: POINTS.inactive,
      matches(player) {
        return Boolean(player.inactive);
      },
    },
    {
      id: 'coaching_p1',
      label: 'Coaching Priorité 1',
      points: POINTS.coaching,
      matches(player, state) {
        return ROSModels.isPlayerInCoachingList(player, state);
      },
    },
  ];

  const els = {};

  function cacheDom() {
    els.root = document.getElementById('panel-recrutement');
    els.list = document.getElementById('recrutementList');
    els.empty = document.getElementById('recrutementEmpty');
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** Exclusions : Absents, R4, R5, Parti (archivés / désactivés). */
  function isExcludedFromRecruitment(player) {
    if (!player) return true;
    if (player.status !== 'Actif') return true;
    if (player.absent) return true;
    if (player.role === 'R4' || player.role === 'R5') return true;
    return false;
  }

  /**
   * Semaines clôturées / archivées uniquement (pas la semaine en cours).
   * Dédupliquées par id.
   */
  function getArchivedWeeks(state) {
    const seen = new Set();
    const weeks = [];
    (state.weeks || []).forEach((week) => {
      if (!week || !week.id) return;
      if (seen.has(week.id)) return;
      if (week.id === state.currentWeekId) return;
      if (!week.archived) return;
      seen.add(week.id);
      weeks.push(week);
    });
    return weeks.sort((a, b) => (a.startDate < b.startDate ? -1 : 1));
  }

  function colorToPoints(color, table) {
    if (color === 'color-red') return table.red;
    if (color === 'color-orange') return table.orange;
    return table.green;
  }

  /**
   * Couleur VS d’une semaine : basée sur les points de jours uniquement
   * (hors pénalité don), pour ne pas mélanger VS et Dons.
   */
  function getVsWeekColor(week, playerId, state) {
    const score = week?.scores?.[playerId];
    if (!score) return null;
    const dayTotal = (ROSModels.DAYS || []).reduce(
      (sum, day) => sum + (Number(score.days?.[day.key]) || 0),
      0
    );
    return ROSModels.getColorClass(dayTotal, state);
  }

  /**
   * Couleur Dons : Vert si don OK, Rouge si don manqué.
   * (Pas d’Orange distinct dans les données actuelles — réserve pour évolutivité.)
   */
  function getDonationWeekColor(week, playerId) {
    const score = week?.scores?.[playerId];
    if (!score) return null;
    return score.allianceDonMissed ? 'color-red' : 'color-green';
  }

  function blankHistoryTotals() {
    return {
      vsPoints: 0,
      donationPoints: 0,
      vsOrangeWeeks: 0,
      vsRedWeeks: 0,
      donationOrangeWeeks: 0,
      donationRedWeeks: 0,
      weeksCounted: 0,
    };
  }

  /** Agrège VS + Dons sur tout l’historique archivé. */
  function aggregateHistoryScore(player, state) {
    const totals = blankHistoryTotals();
    const weeks = getArchivedWeeks(state);

    weeks.forEach((week) => {
      if (!week.scores || !Object.prototype.hasOwnProperty.call(week.scores, player.id)) {
        return;
      }
      totals.weeksCounted += 1;

      const vsColor = getVsWeekColor(week, player.id, state);
      if (vsColor) {
        totals.vsPoints += colorToPoints(vsColor, POINTS.vs);
        if (vsColor === 'color-orange') totals.vsOrangeWeeks += 1;
        if (vsColor === 'color-red') totals.vsRedWeeks += 1;
      }

      const donColor = getDonationWeekColor(week, player.id);
      if (donColor) {
        totals.donationPoints += colorToPoints(donColor, POINTS.donations);
        if (donColor === 'color-orange') totals.donationOrangeWeeks += 1;
        if (donColor === 'color-red') totals.donationRedWeeks += 1;
      }
    });

    return totals;
  }

  function scorePlayer(player, state) {
    const history = aggregateHistoryScore(player, state);
    let inactivePoints = 0;
    let coachingPoints = 0;
    const flags = [];

    RECRUITMENT_CRITERIA.forEach((criterion) => {
      try {
        if (!criterion.matches(player, state)) return;
        const pts = Number(criterion.points) || 0;
        if (criterion.id === 'inactive') inactivePoints = pts;
        else if (criterion.id === 'coaching_p1') coachingPoints = pts;
        flags.push({ id: criterion.id, label: criterion.label, points: pts });
      } catch (error) {
        console.error('Recrutement critère', criterion.id, error);
      }
    });

    const score =
      history.vsPoints + history.donationPoints + inactivePoints + coachingPoints;

    return {
      player,
      score,
      vsPoints: history.vsPoints,
      donationPoints: history.donationPoints,
      inactivePoints,
      coachingPoints,
      vsOrangeWeeks: history.vsOrangeWeeks,
      vsRedWeeks: history.vsRedWeeks,
      donationOrangeWeeks: history.donationOrangeWeeks,
      donationRedWeeks: history.donationRedWeeks,
      weeksCounted: history.weeksCounted,
      flags,
    };
  }

  function getReplacementCandidates(state = ROSStorage.getState()) {
    return (state.players || [])
      .filter((p) => !isExcludedFromRecruitment(p))
      .map((p) => scorePlayer(p, state))
      .filter((row) => row.score >= MIN_SCORE)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.player.pseudo.localeCompare(b.player.pseudo, 'fr', { sensitivity: 'base' });
      });
  }

  function formatWeekCount(n, colorLabel) {
    const count = Number(n) || 0;
    const label = count === 1 ? 'semaine' : 'semaines';
    return `${count} ${label} ${colorLabel}`;
  }

  function renderPlayerCard(row) {
    const inactiveLine =
      row.inactivePoints > 0
        ? `<div>Inactif : <strong>+${row.inactivePoints}</strong></div>`
        : `<div>Inactif : 0</div>`;
    const coachingLine =
      row.coachingPoints > 0
        ? `<div>Coaching : <strong>+${row.coachingPoints}</strong></div>`
        : `<div>Coaching : 0</div>`;

    return `
      <article class="stack-item recrutement-card" data-player-id="${escapeHtml(row.player.id)}">
        <div class="stack-item-main">
          <h4 class="stack-item-title">${escapeHtml(row.player.pseudo)} — ${row.score} points</h4>
          <div class="recrutement-breakdown">
            <div class="recrutement-block">
              <strong>VS : ${row.vsPoints} points</strong>
              <ul>
                <li>${escapeHtml(formatWeekCount(row.vsRedWeeks, 'rouge'))}</li>
                <li>${escapeHtml(formatWeekCount(row.vsOrangeWeeks, 'orange'))}</li>
              </ul>
            </div>
            <div class="recrutement-block">
              <strong>Dons : ${row.donationPoints} points</strong>
              <ul>
                <li>${escapeHtml(formatWeekCount(row.donationRedWeeks, 'rouge'))}</li>
                <li>${escapeHtml(formatWeekCount(row.donationOrangeWeeks, 'orange'))}</li>
              </ul>
            </div>
            <div class="recrutement-block">
              ${inactiveLine}
              ${coachingLine}
            </div>
          </div>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" data-recrutement-open="${escapeHtml(row.player.id)}">
          Fiche
        </button>
      </article>
    `;
  }

  function render() {
    if (!els.list) return;
    const rows = getReplacementCandidates();
    if (!rows.length) {
      els.list.innerHTML = '';
      if (els.empty) els.empty.classList.remove('hidden');
      return;
    }
    if (els.empty) els.empty.classList.add('hidden');
    els.list.innerHTML = rows.map((row) => renderPlayerCard(row)).join('');
  }

  function onClick(event) {
    const btn = event.target.closest('[data-recrutement-open]');
    if (!btn) return;
    const id = btn.dataset.recrutementOpen;
    if (global.PlayersModule?.openDetail) PlayersModule.openDetail(id);
  }

  function init() {
    cacheDom();
    els.root?.addEventListener('click', onClick);
  }

  global.RecrutementModule = {
    init,
    render,
    getReplacementCandidates,
    scorePlayer,
    isExcludedFromRecruitment,
    getArchivedWeeks,
    aggregateHistoryScore,
    RECRUITMENT_CRITERIA,
    POINTS,
    MIN_SCORE,
  };
})(window);
