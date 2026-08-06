/**
 * Module Recrutement — historique pondéré (8 semaines) + groupes de puissance globale.
 */
(function (global) {
  const POINTS = {
    inactive: 40,
    coaching: 10,
    powerStrong: 0,
    powerMid: 10,
    powerWeak: 20,
  };

  const WINDOW_SIZE = 8;
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
  const MIN_SCORE = 15;

  const POWER_GROUPS = {
    strong: {
      id: 'strong',
      label: '30 % les plus forts',
      points: POINTS.powerStrong,
    },
    mid: {
      id: 'mid',
      label: '40 % intermédiaires',
      points: POINTS.powerMid,
    },
    weak: {
      id: 'weak',
      label: '30 % les plus faibles',
      points: POINTS.powerWeak,
    },
  };

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
  let currentSort = 'score';

  function cacheDom() {
    els.root = document.getElementById('panel-recrutement');
    els.list = document.getElementById('recrutementList');
    els.empty = document.getElementById('recrutementEmpty');
    els.sort = document.getElementById('recrutementSort');
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

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
    return `${Math.round(Number(weight) * 100)} %`;
  }

  function formatScoreReal(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '0';
    return String(n).replace('.', ',');
  }

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

  function getArchivedWeeks(state) {
    return getScoringWeeks(state);
  }

  function getPriority(realScore) {
    if (realScore >= 50) {
      return { level: 'high', label: 'Priorité élevée', icon: '🔴' };
    }
    if (realScore >= 30) {
      return { level: 'medium', label: 'Priorité moyenne', icon: '🟠' };
    }
    if (realScore >= MIN_SCORE) {
      return { level: 'watch', label: 'À surveiller', icon: '🟡' };
    }
    return { level: 'none', label: '', icon: '' };
  }

  /**
   * Population classée : actifs, hors R4/R5/archivés, puissance globale renseignée.
   */
  function getPowerRankingPopulation(state) {
    return (state.players || []).filter((player) => {
      if (!player || player.status !== 'Actif') return false;
      if (player.absent) return false;
      if (player.role === 'R4' || player.role === 'R5') return false;
      if (!ROSModels.normalizeGlobalPowerTierId(player.globalPowerTierId)) return false;
      return true;
    });
  }

  /**
   * Groupes 30/40/30 sans séparer une même tranche.
   * Retourne Map(playerId → { group, points, label }).
   */
  function buildPowerGroupAssignments(state) {
    const population = getPowerRankingPopulation(state);
    const assignments = new Map();
    if (!population.length) return assignments;

    const sorted = population.slice().sort((a, b) => {
      const diff =
        ROSModels.getPlayerGlobalPowerSortValue(b) - ROSModels.getPlayerGlobalPowerSortValue(a);
      if (diff !== 0) return diff;
      return a.pseudo.localeCompare(b.pseudo, 'fr', { sensitivity: 'base' });
    });

    const buckets = [];
    sorted.forEach((player) => {
      const tierId = player.globalPowerTierId;
      const last = buckets[buckets.length - 1];
      if (last && last.tierId === tierId) {
        last.players.push(player);
      } else {
        buckets.push({ tierId, players: [player] });
      }
    });

    const n = sorted.length;
    const strongCutoff = n * 0.3;
    const midCutoff = n * 0.7;
    let index = 0;

    buckets.forEach((bucket) => {
      let groupKey = 'weak';
      if (index < strongCutoff) groupKey = 'strong';
      else if (index < midCutoff) groupKey = 'mid';
      const group = POWER_GROUPS[groupKey];
      bucket.players.forEach((player) => {
        assignments.set(player.id, {
          group: group.id,
          points: group.points,
          label: group.label,
        });
      });
      index += bucket.players.length;
    });

    return assignments;
  }

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

  function scorePlayer(player, state, powerAssignments = null) {
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

    const map = powerAssignments || buildPowerGroupAssignments(state);
    const powerInfo = map.get(player.id) || null;
    const hasGlobalPower = Boolean(ROSModels.normalizeGlobalPowerTierId(player.globalPowerTierId));
    const powerPoints = powerInfo ? powerInfo.points : 0;

    const realScore =
      history.weightedVs + inactivePoints + coachingPoints + powerPoints;
    const displayedScore = Math.round(realScore);

    return {
      player,
      score: realScore,
      realScore,
      displayedScore,
      vsPoints: history.weightedVs,
      historyPoints: history.weightedVs,
      inactivePoints,
      coachingPoints,
      powerPoints,
      powerGroup: powerInfo,
      hasGlobalPower,
      globalPowerLabel: ROSModels.getPlayerGlobalPowerLabel(player),
      heroPowerLabel: ROSModels.getPlayerPowerLabel(player, state),
      globalPowerSort: ROSModels.getPlayerGlobalPowerSortValue(player),
      heroPowerSort: ROSModels.getPlayerPowerSortValue(player, state),
      weeksCounted: history.weeksCounted,
      windowSize: history.windowSize,
      weekDetails: history.weekDetails,
      priority: getPriority(realScore),
      flags,
    };
  }

  function sortCandidates(rows, sortKey) {
    const list = rows.slice();
    list.sort((a, b) => {
      if (sortKey === 'global-power') {
        const ag = a.hasGlobalPower ? a.globalPowerSort : Number.POSITIVE_INFINITY;
        const bg = b.hasGlobalPower ? b.globalPowerSort : Number.POSITIVE_INFINITY;
        if (ag !== bg) return ag - bg;
        return a.player.pseudo.localeCompare(b.player.pseudo, 'fr', { sensitivity: 'base' });
      }
      if (sortKey === 'hero-power') {
        const ah = a.heroPowerSort >= 0 ? a.heroPowerSort : Number.POSITIVE_INFINITY;
        const bh = b.heroPowerSort >= 0 ? b.heroPowerSort : Number.POSITIVE_INFINITY;
        if (ah !== bh) return ah - bh;
        return a.player.pseudo.localeCompare(b.player.pseudo, 'fr', { sensitivity: 'base' });
      }
      if (sortKey === 'alpha') {
        return a.player.pseudo.localeCompare(b.player.pseudo, 'fr', { sensitivity: 'base' });
      }
      if (b.realScore !== a.realScore) return b.realScore - a.realScore;
      return a.player.pseudo.localeCompare(b.player.pseudo, 'fr', { sensitivity: 'base' });
    });
    return list;
  }

  function getReplacementCandidates(state = ROSStorage.getState(), sortKey = currentSort) {
    const powerAssignments = buildPowerGroupAssignments(state);
    const rows = (state.players || [])
      .filter((p) => !isExcludedFromRecruitment(p))
      .map((p) => scorePlayer(p, state, powerAssignments))
      .filter((row) => row.realScore >= MIN_SCORE);
    return sortCandidates(rows, sortKey);
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
    const powerBlock = row.hasGlobalPower
      ? `<div>Puissance globale : <strong>${escapeHtml(row.globalPowerLabel)}</strong></div>
         <div>Groupe : ${escapeHtml(row.powerGroup?.label || '—')} → <strong>+${
           row.powerPoints
         }</strong></div>`
      : `<div>Puissance globale : <strong>Puissance à renseigner</strong></div>
         <div>Groupe puissance : 0</div>`;

    return `
      <article class="stack-item recrutement-card" data-player-id="${escapeHtml(row.player.id)}">
        <div class="stack-item-main">
          <div class="recrutement-card-head">
            <h4 class="stack-item-title">${escapeHtml(row.player.pseudo)} — ${
              row.displayedScore
            } points</h4>
            <span class="recrutement-priority recrutement-priority-${priority.level}">
              ${priority.icon} ${escapeHtml(priority.label)}
            </span>
          </div>
          <div class="recrutement-breakdown">
            <div class="recrutement-block">
              ${powerBlock}
              <div>Puissance héros : ${escapeHtml(row.heroPowerLabel)}</div>
            </div>
            <div class="recrutement-block">
              <strong>Historique pondéré : +${escapeHtml(formatScoreReal(row.historyPoints))}</strong>
              <ul>${renderWeekDetailLines(row.weekDetails)}</ul>
            </div>
            <div class="recrutement-block">
              <div>Coaching : ${
                row.coachingPoints > 0 ? `<strong>+${row.coachingPoints}</strong>` : '0'
              }</div>
              <div>Inactif : ${
                row.inactivePoints > 0 ? `<strong>+${row.inactivePoints}</strong>` : '0'
              }</div>
              <div>Score réel : <strong>${escapeHtml(formatScoreReal(row.realScore))}</strong></div>
            </div>
          </div>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" data-recrutement-open="${escapeHtml(
          row.player.id
        )}">
          Fiche
        </button>
      </article>
    `;
  }

  function render() {
    if (!els.list) return;
    if (els.sort) currentSort = els.sort.value || 'score';
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
    els.sort?.addEventListener('change', () => {
      currentSort = els.sort.value || 'score';
      render();
    });
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
    buildPowerGroupAssignments,
    getPowerRankingPopulation,
    getPriority,
    weightForRank,
    RECRUITMENT_CRITERIA,
    POINTS,
    MIN_SCORE,
    WINDOW_SIZE,
    WEIGHT_BY_RANK,
    POWER_GROUPS,
  };
})(window);
