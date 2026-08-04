/**
 * Module VS hebdomadaire — gestion sécurisée des semaines
 */
(function (global) {
  const els = {};
  let rendering = false;

  function cacheDom() {
    els.weekSelector = document.getElementById('weekSelector');
    els.btnNewWeek = document.getElementById('btnNewWeek');
    els.tbody = document.getElementById('vsTableBody');
    els.empty = document.getElementById('vsEmpty');
    els.table = document.getElementById('vsTable');
    els.activeTitle = document.getElementById('vsActiveWeekTitle');
    els.activeDates = document.getElementById('vsActiveWeekDates');
    els.archiveNotice = document.getElementById('vsArchiveNotice');
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function getSelectedWeek() {
    const state = ROSStorage.getState();
    const selectedId = els.weekSelector.value || state.currentWeekId;
    return state.weeks.find((w) => w.id === selectedId) || state.weeks[0];
  }

  function getActiveWeek(state) {
    const current = state || ROSStorage.getState();
    return current.weeks.find((w) => w.id === current.currentWeekId) || current.weeks[0];
  }

  function isSelectedEditable() {
    const state = ROSStorage.getState();
    return ROSModels.isWeekEditable(getSelectedWeek(), state.currentWeekId);
  }

  function renderWeekBar() {
    const state = ROSStorage.getState();
    const active = getActiveWeek(state);
    const selected = getSelectedWeek();

    if (els.activeTitle && active) {
      els.activeTitle.textContent = active.label || `Semaine ${active.number || '?'}`;
    }
    if (els.activeDates && active) {
      els.activeDates.textContent = `${ROSModels.formatDateFR(active.startDate)} → ${ROSModels.formatDateFR(active.endDate)}`;
    }

    const selectedId = els.weekSelector.value || state.currentWeekId;
    els.weekSelector.innerHTML = state.weeks
      .map((week) => {
        const mark = week.id === state.currentWeekId ? ' — active' : ' — archivée';
        return `<option value="${week.id}">${escapeHtml(week.label || `Semaine ${week.number}`)}${mark}</option>`;
      })
      .join('');

    if (state.weeks.some((w) => w.id === selectedId)) {
      els.weekSelector.value = selectedId;
    } else {
      els.weekSelector.value = state.currentWeekId;
    }

    const editable = ROSModels.isWeekEditable(selected, state.currentWeekId);
    els.archiveNotice.classList.toggle('hidden', editable);
    if (!editable && selected) {
      const by =
        global.ROSProfiles && typeof ROSProfiles.resolveActor === 'function'
          ? ROSProfiles.resolveActor(selected)
          : selected.closedBy || '';
      els.archiveNotice.textContent =
        by && by !== '—'
          ? `Archive VS — clôturée par ${by} (consultation seule)`
          : 'Archive VS — consultation seule (non modifiable)';
    }
  }

  function dayCellHtml(playerId, dayKey, value, editable) {
    if (!editable) {
      const label =
        ROSModels.DAY_OPTIONS.find((opt) => opt.value === Number(value))?.label || `${value} pts`;
      return `<td><span class="vs-readonly">${escapeHtml(label)}</span></td>`;
    }

    const options = ROSModels.DAY_OPTIONS.map(
      (opt) =>
        `<option value="${opt.value}" ${Number(value) === opt.value ? 'selected' : ''}>${opt.label}</option>`
    ).join('');

    return `
      <td>
        <select
          class="input"
          data-vs-day
          data-player="${playerId}"
          data-day="${dayKey}"
          aria-label="Score ${dayKey}"
        >${options}</select>
      </td>
    `;
  }

  function donationCellHtml(playerId, missed, editable) {
    if (!editable) {
      return `<td><span class="vs-readonly">${missed ? 'Non réalisés' : 'OK'}</span></td>`;
    }
    return `
      <td>
        <label>
          <input
            type="checkbox"
            data-vs-don
            data-player="${playerId}"
            ${missed ? 'checked' : ''}
          />
          +5 pts
        </label>
      </td>
    `;
  }

  function playersForWeek(week, editable) {
    const state = ROSStorage.getState();

    if (editable) {
      // Semaine active : tous les Actifs (Absents inclus, Parti exclus)
      return state.players
        .filter((p) => p.status === 'Actif')
        .sort((a, b) => a.pseudo.localeCompare(b.pseudo, 'fr', { sensitivity: 'base' }));
    }

    // Archive : joueurs présents dans le snapshot (historique figé)
    const ids = Object.keys(week.scores || {});
    return ids
      .map((id) => state.players.find((p) => p.id === id) || { id, pseudo: 'Joueur retiré', role: '—' })
      .sort((a, b) => a.pseudo.localeCompare(b.pseudo, 'fr', { sensitivity: 'base' }));
  }

  function ensureActiveScores(weekId, playerIds) {
    const state = ROSStorage.getState();
    if (weekId !== state.currentWeekId) return;

    const week = state.weeks.find((w) => w.id === weekId);
    if (!week || week.archived) return;

    const missing = playerIds.filter((id) => !week.scores[id]);
    if (!missing.length) return;

    ROSStorage.update(
      (s) => {
        const target = s.weeks.find((w) => w.id === weekId);
        if (!target || target.id !== s.currentWeekId) return s;
        missing.forEach((id) => {
          if (!target.scores[id]) {
            target.scores[id] = ROSModels.createEmptyScore();
          }
        });
        return s;
      },
      { silent: true }
    );
  }

  function render() {
    if (rendering) return;
    rendering = true;

    try {
      renderWeekBar();
      const state = ROSStorage.getState();
      const week = getSelectedWeek();
      const editable = ROSModels.isWeekEditable(week, state.currentWeekId);
      const players = playersForWeek(week, editable);

      if (!players.length) {
        els.tbody.innerHTML = '';
        els.table.classList.add('hidden');
        els.empty.classList.remove('hidden');
        els.empty.textContent = editable
          ? 'Aucun joueur actif. Ajoutez des joueurs pour saisir le VS.'
          : 'Aucun snapshot pour cette semaine archivée.';
        return;
      }

      els.table.classList.remove('hidden');
      els.empty.classList.add('hidden');

      if (editable) {
        ensureActiveScores(
          week.id,
          players.map((p) => p.id)
        );
      }

      const freshWeek = ROSStorage.getState().weeks.find((w) => w.id === week.id) || week;

      els.tbody.innerHTML = players
        .map((player) => {
          const localScore = freshWeek.scores[player.id] || ROSModels.createEmptyScore();
          const ignored = Boolean(player.absent) && editable;
          const total = ignored ? 0 : ROSModels.computeTotal(localScore);
          const color = ignored ? 'color-green' : ROSModels.getColorClass(total);
          const rowEditable = editable && !player.absent;

          const dayCells = ROSModels.DAYS.map((day) =>
            dayCellHtml(
              player.id,
              day.key,
              ignored ? 0 : localScore.days[day.key],
              rowEditable
            )
          ).join('');

          const absentBadge = player.absent
            ? ' <span class="badge badge-absent">Absent</span>'
            : '';

          return `
            <tr data-player-row="${player.id}" class="${ignored ? 'vs-row-absent' : ''}">
              <td><strong>${escapeHtml(player.pseudo)}</strong>${absentBadge}</td>
              <td>${escapeHtml(player.role)}</td>
              ${dayCells}
              ${donationCellHtml(player.id, ignored ? false : localScore.allianceDonMissed, rowEditable)}
              <td class="total-cell ${color}" data-total-for="${player.id}">${total}</td>
            </tr>
          `;
        })
        .join('');
    } finally {
      rendering = false;
    }
  }

  function refreshRowTotal(playerId) {
    if (!isSelectedEditable()) return;
    const player = ROSStorage.getPlayerById(playerId);
    if (player?.absent) return;

    const week = getSelectedWeek();
    const score = week.scores[playerId] || ROSModels.createEmptyScore();
    const total = ROSModels.computeTotal(score);
    const color = ROSModels.getColorClass(total);
    const cell = els.tbody.querySelector(`[data-total-for="${playerId}"]`);
    if (!cell) return;
    cell.textContent = String(total);
    cell.classList.remove('color-green', 'color-orange', 'color-red');
    cell.classList.add(color);
  }

  function syncSideViews() {
    if (global.CommandModule) CommandModule.render();
    if (global.PlayersModule) PlayersModule.render();
    if (global.ArchivesModule) ArchivesModule.render();
    if (global.NotificationsModule) NotificationsModule.render();
  }

  function updateDay(playerId, dayKey, value) {
    const state = ROSStorage.getState();
    const weekId = els.weekSelector.value;
    const week = state.weeks.find((w) => w.id === weekId);
    if (!ROSModels.isWeekEditable(week, state.currentWeekId)) {
      AppUI.toast('Les archives VS ne peuvent pas être modifiées.');
      render();
      return;
    }

    const player = ROSStorage.getPlayerById(playerId);
    if (!player || player.status !== 'Actif' || player.absent) return;

    const points = Number(value);
    if (![0, 5, 10].includes(points)) return;

    ROSStorage.update(
      (s) => {
        const target = s.weeks.find((w) => w.id === weekId);
        if (!ROSModels.isWeekEditable(target, s.currentWeekId)) return s;
        const score = ROSModels.ensurePlayerScore(target, playerId);
        score.days[dayKey] = points;
        return s;
      },
      { silent: true }
    );

    refreshRowTotal(playerId);
    syncSideViews();
  }

  function updateDonation(playerId, checked) {
    const state = ROSStorage.getState();
    const weekId = els.weekSelector.value;
    const week = state.weeks.find((w) => w.id === weekId);
    if (!ROSModels.isWeekEditable(week, state.currentWeekId)) {
      AppUI.toast('Les archives VS ne peuvent pas être modifiées.');
      render();
      return;
    }

    const player = ROSStorage.getPlayerById(playerId);
    if (!player || player.status !== 'Actif' || player.absent) return;

    ROSStorage.update(
      (s) => {
        const target = s.weeks.find((w) => w.id === weekId);
        if (!ROSModels.isWeekEditable(target, s.currentWeekId)) return s;
        const score = ROSModels.ensurePlayerScore(target, playerId);
        score.allianceDonMissed = Boolean(checked);
        return s;
      },
      { silent: true }
    );

    refreshRowTotal(playerId);
    syncSideViews();
  }

  function nextAvailableMonday() {
    const state = ROSStorage.getState();
    const existing = new Set(state.weeks.map((w) => w.startDate));
    const calendarMonday = ROSModels.startOfWeekMonday();
    let candidate = calendarMonday;

    if (existing.has(ROSModels.toISODate(candidate))) {
      const starts = state.weeks.map((w) => w.startDate).sort();
      const latestStart = starts[starts.length - 1];
      candidate = ROSModels.addDays(new Date(`${latestStart}T12:00:00`), 7);
    }

    while (existing.has(ROSModels.toISODate(candidate))) {
      candidate = ROSModels.addDays(candidate, 7);
    }

    return candidate;
  }

  async function createNewWeek() {
    const ok = await AppUI.confirm({
      title: 'Créer la semaine suivante',
      message: 'Créer la semaine suivante ? La semaine actuelle sera automatiquement archivée.',
      confirmLabel: 'Créer',
    });
    if (!ok) return;

    const startDateObj = nextAvailableMonday();

    ROSStorage.update((s) => {
      // 1. Archiver complètement la semaine actuelle (scores intacts, jamais supprimés)
      const current = s.weeks.find((w) => w.id === s.currentWeekId);
      if (current) {
        current.archived = true;
        current.closedAt = new Date().toISOString();
        const actor =
          global.ROSProfiles && typeof ROSProfiles.stampActor === 'function'
            ? ROSProfiles.stampActor()
            : { actorUserId: '', actorPlayerId: null, actorLabel: '' };
        current.closedByUserId = actor.actorUserId || '';
        current.closedByPlayerId = actor.actorPlayerId || null;
        current.closedBy = actor.actorLabel || '';
      }

      // 2. Créer la semaine suivante
      const week = ROSModels.createWeek(startDateObj, {
        number: ROSModels.getNextWeekNumber(s.weeks),
        archived: false,
      });

      // 3–9. Actifs uniquement (Absents inclus avec case Absent inchangée côté joueur)
      // Parti exclus. Jours = Plus de 7,2 M (0), dons = NON, total 0, couleur Verte.
      s.players
        .filter((p) => p.status === 'Actif')
        .forEach((p) => {
          week.scores[p.id] = ROSModels.createEmptyScore();
        });

      s.weeks.unshift(week);
      s.currentWeekId = week.id;
      return s;
    });

    els.weekSelector.value = ROSStorage.getState().currentWeekId;
    AppUI.toast('Nouvelle semaine créée. La précédente est archivée.');
  }

  function onTableChange(event) {
    const daySelect = event.target.closest('[data-vs-day]');
    if (daySelect) {
      updateDay(daySelect.dataset.player, daySelect.dataset.day, daySelect.value);
      return;
    }

    const donCheck = event.target.closest('[data-vs-don]');
    if (donCheck) {
      updateDonation(donCheck.dataset.player, donCheck.checked);
    }
  }

  function init() {
    cacheDom();
    els.btnNewWeek.addEventListener('click', createNewWeek);
    els.weekSelector.addEventListener('change', render);
    els.tbody.addEventListener('change', onTableChange);
  }

  global.VSModule = { init, render, getSelectedWeek, getActiveWeek };
})(window);
