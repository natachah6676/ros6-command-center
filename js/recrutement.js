/**
 * Module Recrutement — score de remplacement sur les 8 dernières semaines archivées,
 * avec pondération récente + bonus Inactif / Coaching.
 */
(function (global) {
  const POINTS = {
    inactive: 40,
    coaching: 10,
  };

  /** Fenêtre glissante (semaines archivées les plus récentes). */
  const WINDOW_SIZE = 8;

  /** Pondération par rang (1 = semaine archivée la plus récente). */
  const WEIGHT_BY_RANK = {
    1: 1,
    2: 1,
    3: 0.75,
    4: 0.75,
    5: 0.5,
    6: 0.5,
    7: 0.5,
    8: 0.5,
  };

  /** Score réel minimum pour apparaître dans la liste. */
  const MIN_SCORE = 30;

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

  /** Exclusions : Absents, R4, R5, Parti / désactivés. */
  function isExcludedFromRecruitment(player) {
    if (!player) return true;
    if (player.status !== 'Actif') return true;
    if (player.absent) return true;
    if (player.role === 'R4' || player.role === 'R5') return true;
    return false;
  }

  function weightForRank(rank) {
    return WEIGHT_BY_RANK[rank] ?? 0;
  }

  function formatWeightPercent(weight) {
    const pct = Math.round(Number(weight) * 100);
    return `${pct} %`;
  }

  function formatScoreReal(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '0';
    return String(n).replace('.', ',');
  }

  /**
   * 8 dernières semaines archivées (hors semaine courante), plus récentes d’abord.
   * Les archives plus anciennes restent en base mais sortent du calcul.
   */
  function getScoringWeeks(state) {
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
    weeks.sort((a, b) => {
      if (a.startDate === b.startDate) return a.id < b.id ? 1 : -1;
      return a.startDate < b.startDate ? 1 : -1;
    });
    return weeks.slice(0, WINDOW_SIZE);
  }

  /** Alias conservé pour les tests / API. */
  function getArchivedWeeks(state) {
    return getScoringWeeks(state);
  }

  function getPriority(realScore) {
    if (realScore >= 50) {
      return { level: 'high', label: 'Priorité élevée', icon: '🔴' };
    }
    if (realScore >= MIN_SCORE) {
      return { level: 'medium', label: 'Priorité moyenne', icon: '🟠' };
    }
    return { level: 'none', label: '', icon: '' };
  }

  /**
   * Agrège les totaux Archives (computeTotal) sur la fenêtre pondérée.
   */
  function aggregateHistoryScore(player, state) {
    const scoringWeeks = getScoringWeeks(state);
    const weekDetails = [];
    let weightedVs = 0;

    scoringWeeks.forEach((week, index) => {
      const rank = index + 1;
      const weight = weightForRank(rank);
      if (!week.scores || !Object.prototype.hasOwnProperty.call(week.scores, player.id)) {
        return;
      }
      const score = week.scores[player.id];
      if (!score) return;

      const rawTotal = ROSModels.computeTotal(score, state);
      const weighted = rawTotal * weight;
      weightedVs += weighted;
      weekDetails.push({
        weekId: week.id,
        label: week.label || `Semaine ${week.number || rank}`,
        rank,
        weight,
        rawTotal,
        weighted,
      });
    });

    return {
      weightedVs,
      weekDetails,
      weeksCounted: weekDetails.length,
      windowSize: scoringWeeks.length,
    };
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

    const realScore = history.weightedVs + inactivePoints + coachingPoints;
    const displayedScore = Math.round(realScore);
    const priority = getPriority(realScore);

    return {
      player,
      /** Score réel (tri). */
      score: realScore,
      realScore,
      displayedScore,
      vsPoints: history.weightedVs,
      donationPoints: 0,
      inactivePoints,
      coachingPoints,
      weeksCounted: history.weeksCounted,
      windowSize: history.windowSize,
      weekDetails: history.weekDetails,
      priority,
      flags,
    };
  }

  function getReplacementCandidates(state = ROSStorage.getState()) {
    return (state.players || [])
      .filter((p) => !isExcludedFromRecruitment(p))
      .map((p) => scorePlayer(p, state))
      .filter((row) => row.realScore >= MIN_SCORE)
      .sort((a, b) => {
        if (b.realScore !== a.realScore) return b.realScore - a.realScore;
        return a.player.pseudo.localeCompare(b.player.pseudo, 'fr', { sensitivity: 'base' });
      });
  }

  function renderWeekDetailLines(weekDetails) {
    if (!weekDetails.length) {
      return '<li>Aucune semaine dans la fenêtre</li>';
    }
    return weekDetails
      .map(
        (w) =>
          `<li>Semaine ${w.rank} : ${escapeHtml(String(w.rawTotal))} ×${escapeHtml(
            formatWeightPercent(w.weight)
          )}</li>`
      )
      .join('');
  }

  function renderPlayerCard(row) {
    const priority = row.priority || getPriority(row.realScore);
    return `
      <article class="stack-item recrutement-card" data-player-id="${escapeHtml(row.player.id)}">
        <div class="stack-item-main">
          <div class="recrutement-card-head">
            <h4 class="stack-item-title">${escapeHtml(row.player.pseudo)}</h4>
            <span class="recrutement-priority recrutement-priority-${priority.level}">
              ${priority.icon} ${escapeHtml(priority.label)}
            </span>
          </div>
          <div class="recrutement-breakdown">
            <div class="recrutement-block">
              <strong>VS :</strong>
              <ul>${renderWeekDetailLines(row.weekDetails)}</ul>
            </div>
            <div class="recrutement-block">
              <div>Coaching : ${
                row.coachingPoints > 0 ? `<strong>+${row.coachingPoints}</strong>` : '0'
              }</div>
              <div>Inactif : ${
                row.inactivePoints > 0 ? `<strong>+${row.inactivePoints}</strong>` : '0'
              }</div>
            </div>
            <div class="recrutement-block recrutement-scores">
              <div>Score réel : <strong>${escapeHtml(formatScoreReal(row.realScore))}</strong></div>
              <div>Score affiché : <strong>${row.displayedScore}</strong></div>
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
    getScoringWeeks,
    aggregateHistoryScore,
    getPriority,
    weightForRank,
    RECRUITMENT_CRITERIA,
    POINTS,
    MIN_SCORE,
    WINDOW_SIZE,
    WEIGHT_BY_RANK,
  };
})(window);
