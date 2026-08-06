/**
 * Module Recrutement — joueurs à remplacer.
 * Score = somme des totaux Archives (computeTotal) sur toutes les semaines
 * + bonus Inactif / Coaching.
 */
(function (global) {
  const POINTS = {
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

  /**
   * Exclusions : R4, R5, Parti / désactivés.
   * (Les joueurs marqués « absent » restent visibles — même source qu’Archives.)
   */
  function isExcludedFromRecruitment(player) {
    if (!player) return true;
    if (player.status !== 'Actif') return true;
    if (player.role === 'R4' || player.role === 'R5') return true;
    return false;
  }

  /**
   * Même source que le module Archives : toutes les semaines de state.weeks,
   * dédupliquées par id (y compris la semaine en cours si présente).
   */
  function getArchivedWeeks(state) {
    const seen = new Set();
    const weeks = [];
    (state.weeks || []).forEach((week) => {
      if (!week || !week.id) return;
      if (seen.has(week.id)) return;
      seen.add(week.id);
      weeks.push(week);
    });
    return weeks.sort((a, b) => (a.startDate < b.startDate ? -1 : 1));
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
      weekDetails: [],
    };
  }

  /**
   * Agrège les totaux affichés dans Archives (ROSModels.computeTotal)
   * pour chaque semaine où le joueur a une entrée de score.
   */
  function aggregateHistoryScore(player, state) {
    const totals = blankHistoryTotals();
    const weeks = getArchivedWeeks(state);

    weeks.forEach((week) => {
      if (!week.scores || !Object.prototype.hasOwnProperty.call(week.scores, player.id)) {
        return;
      }
      const score = week.scores[player.id];
      if (!score) return;

      const dayTotal = (ROSModels.DAYS || []).reduce(
        (sum, day) => sum + (Number(score.days?.[day.key]) || 0),
        0
      );
      const total = ROSModels.computeTotal(score, state);
      const donationPart = Math.max(0, total - dayTotal);
      const color = ROSModels.getColorClass(total, state);

      totals.weeksCounted += 1;
      totals.vsPoints += dayTotal;
      totals.donationPoints += donationPart;
      totals.weekDetails.push({
        weekId: week.id,
        label: week.label || week.id,
        dayTotal,
        donationPart,
        total,
        color,
        archived: Boolean(week.archived),
        isCurrent: week.id === state.currentWeekId,
      });

      if (color === 'color-orange') totals.vsOrangeWeeks += 1;
      if (color === 'color-red') totals.vsRedWeeks += 1;
      if (score.allianceDonMissed) totals.donationRedWeeks += 1;
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

    const archiveTotal = history.vsPoints + history.donationPoints;
    const score = archiveTotal + inactivePoints + coachingPoints;

    return {
      player,
      score,
      archiveTotal,
      vsPoints: history.vsPoints,
      donationPoints: history.donationPoints,
      inactivePoints,
      coachingPoints,
      vsOrangeWeeks: history.vsOrangeWeeks,
      vsRedWeeks: history.vsRedWeeks,
      donationOrangeWeeks: history.donationOrangeWeeks,
      donationRedWeeks: history.donationRedWeeks,
      weeksCounted: history.weeksCounted,
      weekDetails: history.weekDetails,
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
