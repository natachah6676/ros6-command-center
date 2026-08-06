/**
 * Module Recrutement — joueurs à remplacer (score automatique).
 * Critères déclaratifs : ajouter une entrée dans RECRUITMENT_CRITERIA pour étendre.
 */
(function (global) {
  /**
   * Architecture évolutive : chaque critère expose id, label, points, matches(player, state).
   * L’ordre du tableau n’impacte que l’affichage des raisons.
   */
  const RECRUITMENT_CRITERIA = [
    {
      id: 'inactive',
      label: 'Inactif',
      points: 40,
      matches(player) {
        return Boolean(player.inactive);
      },
    },
    {
      id: 'vs_red_2',
      label: 'VS rouge 2 semaines',
      points: 30,
      matches(player, state) {
        return ROSModels.countConsecutiveRed(state, player.id) >= 2;
      },
    },
    {
      id: 'donations_red_2',
      label: 'Dons rouge 2 semaines',
      points: 20,
      matches(player, state) {
        return ROSModels.countConsecutiveMissedDonations(state, player.id) >= 2;
      },
    },
    {
      id: 'coaching_p1',
      label: 'Coaching Priorité 1',
      points: 10,
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

  /** Exclusions : Absents, R4, R5, Parti (archivés / désactivés côté membres). */
  function isExcludedFromRecruitment(player) {
    if (!player) return true;
    if (player.status !== 'Actif') return true;
    if (player.absent) return true;
    if (player.role === 'R4' || player.role === 'R5') return true;
    return false;
  }

  function scorePlayer(player, state) {
    const reasons = [];
    let score = 0;
    RECRUITMENT_CRITERIA.forEach((criterion) => {
      try {
        if (criterion.matches(player, state)) {
          score += Number(criterion.points) || 0;
          reasons.push({ id: criterion.id, label: criterion.label, points: criterion.points });
        }
      } catch (error) {
        console.error('Recrutement critère', criterion.id, error);
      }
    });
    return { player, score, reasons };
  }

  function getReplacementCandidates(state = ROSStorage.getState()) {
    return (state.players || [])
      .filter((p) => !isExcludedFromRecruitment(p))
      .map((p) => scorePlayer(p, state))
      .filter((row) => row.score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.player.pseudo.localeCompare(b.player.pseudo, 'fr', { sensitivity: 'base' });
      });
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
    els.list.innerHTML = rows
      .map((row) => {
        const reasons = row.reasons
          .map((r) => `<li>✓ ${escapeHtml(r.label)}</li>`)
          .join('');
        return `
          <article class="stack-item recrutement-card" data-player-id="${escapeHtml(row.player.id)}">
            <div class="stack-item-main">
              <h4 class="stack-item-title">${escapeHtml(row.player.pseudo)}</h4>
              <p class="panel-subtitle">Score : <strong>${row.score}</strong></p>
              <ul class="recrutement-reasons">${reasons}</ul>
            </div>
            <button type="button" class="btn btn-ghost btn-sm" data-recrutement-open="${escapeHtml(row.player.id)}">
              Fiche
            </button>
          </article>
        `;
      })
      .join('');
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
    RECRUITMENT_CRITERIA,
  };
})(window);
