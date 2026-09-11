/**
 * Module VS — semaines suivies à la demande · clôture / création séparées
 */
(function (global) {
  const els = {};
  let rendering = false;

  function cacheDom() {
    els.weekSelector = document.getElementById('weekSelector');
    els.btnNewWeek = document.getElementById('btnNewWeek');
    els.btnCloseWeek = document.getElementById('btnCloseWeek');
    els.tbody = document.getElementById('vsTableBody');
    els.empty = document.getElementById('vsEmpty');
    els.table = document.getElementById('vsTable');
    els.activeTitle = document.getElementById('vsActiveWeekTitle');
    els.activeDates = document.getElementById('vsActiveWeekDates');
    els.archiveNotice = document.getElementById('vsArchiveNotice');
    els.noActiveNotice = document.getElementById('vsNoActiveNotice');
    els.legend = document.getElementById('vsLegend');
    els.settingsForm = document.getElementById('vsSettingsForm');
    els.settingsBlock = document.getElementById('settingsVsBlock');
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function canEditVsSettings() {
    return Boolean(global.ROSProfiles && typeof ROSProfiles.isActiveR5 === 'function' && ROSProfiles.isActiveR5());
  }

  function getSelectedWeek() {
    const state = ROSStorage.getState();
    const weeks = state.weeks || [];
    if (!weeks.length) return null;
    const selectedId = els.weekSelector?.value || state.currentWeekId;
    return weeks.find((w) => w.id === selectedId) || weeks[0] || null;
  }

  /** Semaine réellement active (éditable) — null s’il n’y en a pas. */
  function getActiveWeek(state) {
    const current = state || ROSStorage.getState();
    if (!current.currentWeekId) return null;
    return (current.weeks || []).find((w) => w.id === current.currentWeekId) || null;
  }

  function isSelectedEditable() {
    const state = ROSStorage.getState();
    return ROSModels.isWeekEditable(getSelectedWeek(), state.currentWeekId);
  }

  function renderLegend(state) {
    if (!els.legend) return;
    const settings = ROSModels.getVsSettings(state);
    const options = ROSModels.getDayOptions(settings);
    const cfg = ROSModels.getActiveVsConfig(settings);
    const thresholds = ROSModels.getColorThresholds(settings);
    const donation = cfg.donationPenalty;
    const orangeMax = Math.max(thresholds.orangeFrom, thresholds.redFrom - 1);

    const optionItems = options
      .map(
        (opt) =>
          `<span class="legend-item"><span class="swatch score-${
            opt.bracket === 'ok' ? '0' : opt.bracket === 'mid' ? '5' : '10'
          }"></span> ${escapeHtml(opt.label)}</span>`
      )
      .join('');

    els.legend.innerHTML = `
      ${optionItems}
      <span class="legend-item"><span class="swatch score-don"></span> Dons non réalisés · ${donation} pts</span>
      <span class="legend-item"><span class="dot color-green"></span> 0–${thresholds.orangeFrom - 1}</span>
      <span class="legend-item"><span class="dot color-orange"></span> ${thresholds.orangeFrom}–${orangeMax}</span>
      <span class="legend-item"><span class="dot color-red"></span> ≥ ${thresholds.redFrom}</span>
    `;
  }

  function renderWeekBar() {
    const state = ROSStorage.getState();
    const active = getActiveWeek(state);
    const weeks = state.weeks || [];

    if (els.activeTitle) {
      els.activeTitle.textContent = active
        ? active.label || `Semaine ${active.number || '?'}`
        : 'Aucune';
    }
    if (els.activeDates) {
      els.activeDates.textContent = active
        ? `${ROSModels.formatDateFR(active.startDate)} → ${ROSModels.formatDateFR(active.endDate)}`
        : '';
    }

    if (els.btnCloseWeek) {
      els.btnCloseWeek.disabled = !active;
    }
    if (els.btnNewWeek) {
      els.btnNewWeek.disabled = Boolean(active);
      els.btnNewWeek.title = active
        ? 'Clôturez d’abord la semaine VS active'
        : 'Créer une semaine VS à fond';
    }

    const previousSelectedId = els.weekSelector.value || state.currentWeekId;
    els.weekSelector.innerHTML = weeks
      .map((week) => {
        const mark =
          week.id === state.currentWeekId && !week.archived ? ' — active' : ' — clôturée';
        return `<option value="${week.id}">${escapeHtml(week.label || `Semaine ${week.number}`)}${mark}</option>`;
      })
      .join('');

    if (weeks.some((w) => w.id === previousSelectedId)) {
      els.weekSelector.value = previousSelectedId;
    } else if (state.currentWeekId && weeks.some((w) => w.id === state.currentWeekId)) {
      els.weekSelector.value = state.currentWeekId;
    } else if (weeks[0]) {
      els.weekSelector.value = weeks[0].id;
    }

    const selected = getSelectedWeek();
    const editable = ROSModels.isWeekEditable(selected, state.currentWeekId);

    if (els.noActiveNotice) {
      if (!active && !selected) {
        els.noActiveNotice.classList.remove('hidden');
        els.noActiveNotice.textContent =
          'Aucune semaine VS. Créez une semaine lorsque vous jouez le VS à fond.';
      } else if (!active && selected) {
        els.noActiveNotice.classList.remove('hidden');
        els.noActiveNotice.textContent =
          'Aucune semaine VS active. Consultez l’historique ou créez une nouvelle semaine à fond.';
      } else {
        els.noActiveNotice.classList.add('hidden');
      }
    }

    els.archiveNotice.classList.toggle('hidden', editable || !selected);
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

  function dayCellHtml(playerId, dayKey, value, bracket, editable, state) {
    const settings = ROSModels.getVsSettings(state);
    const displayBracket =
      settings.mode === 'eco' && bracket === 'mid' ? 'ok' : bracket || ROSModels.inferDayBracket(value);

    if (!editable) {
      const label = ROSModels.labelForDayPoints(value, state, displayBracket);
      return `<td><span class="vs-readonly">${escapeHtml(label)}</span></td>`;
    }

    const options = ROSModels.getDayOptions(state)
      .map((opt) => {
        const selected = opt.bracket === displayBracket;
        return `<option value="${opt.bracket}" ${selected ? 'selected' : ''}>${escapeHtml(
          opt.label
        )}</option>`;
      })
      .join('');

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

  function donationCellHtml(playerId, missed, editable, donationPts) {
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
          +${donationPts} pts
        </label>
      </td>
    `;
  }

  function playersForWeek(week, editable) {
    const state = ROSStorage.getState();
    if (!week) return [];

    if (editable) {
      return state.players
        .filter((p) => p.status === 'Actif')
        .sort((a, b) => a.pseudo.localeCompare(b.pseudo, 'fr', { sensitivity: 'base' }));
    }

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

  function fillSettingsForm(state) {
    const settings = ROSModels.getVsSettings(state);
    const setVal = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.value = value;
    };
    setVal('vsAfondDailyGoal', settings.afond.dailyGoal);
    setVal('vsAfondMidMin', settings.afond.midMin);
    setVal('vsAfondMidPoints', settings.afond.midPoints);
    setVal('vsAfondLowPoints', settings.afond.lowPoints);
    setVal('vsAfondDonation', settings.afond.donationPenalty);
    setVal('vsAfondRedFrom', settings.afond.redFrom);

    const editable = canEditVsSettings();
    [
      'vsAfondDailyGoal',
      'vsAfondMidMin',
      'vsAfondMidPoints',
      'vsAfondLowPoints',
      'vsAfondDonation',
      'vsAfondRedFrom',
    ].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.disabled = !editable;
    });
    const submit = els.settingsForm?.querySelector('button[type="submit"]');
    if (submit) submit.disabled = !editable;
  }

  function renderSettings() {
    if (!canEditVsSettings()) return;
    fillSettingsForm(ROSStorage.getState());
  }

  function render() {
    if (rendering) return;
    rendering = true;

    try {
      const state = ROSStorage.getState();
      renderLegend(state);
      renderWeekBar();
      const settingsPane = document.getElementById('settingsPaneVs');
      if (
        settingsPane &&
        typeof settingsPane.classList?.contains === 'function' &&
        !settingsPane.classList.contains('hidden')
      ) {
        fillSettingsForm(state);
      }

      const week = getSelectedWeek();
      const editable = ROSModels.isWeekEditable(week, state.currentWeekId);
      const players = playersForWeek(week, editable);
      const cfg = ROSModels.getActiveVsConfig(state);

      if (!week) {
        els.tbody.innerHTML = '';
        els.table.classList.add('hidden');
        els.empty.classList.remove('hidden');
        els.empty.textContent =
          'Aucune semaine VS. Cliquez sur « Nouvelle semaine VS » lorsque vous jouez le VS à fond.';
        return;
      }

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

      const freshState = ROSStorage.getState();
      const freshWeek = freshState.weeks.find((w) => w.id === week.id) || week;

      els.tbody.innerHTML = players
        .map((player) => {
          const localScore = freshWeek.scores[player.id] || ROSModels.createEmptyScore();
          ROSModels.ensureDayBrackets(localScore);
          const histAbsent = !editable && ROSModels.isScoreAbsent(localScore);
          const liveAbsent = editable && Boolean(player.absent);
          const ignored = liveAbsent || histAbsent;
          const total = ignored ? 0 : ROSModels.computeTotal(localScore, freshState);
          const color = ignored ? 'color-green' : ROSModels.getColorClass(total, freshState);
          const rowEditable = editable && !player.absent;
          const under = ignored ? 0 : ROSModels.countDaysUnderObjective(localScore);
          const met = ignored ? 5 : ROSModels.countObjectivesMet(localScore);

          const dayCells = ROSModels.DAYS.map((day) =>
            dayCellHtml(
              player.id,
              day.key,
              ignored ? 0 : localScore.days[day.key],
              ignored ? 'ok' : localScore.dayBrackets[day.key],
              rowEditable,
              freshState
            )
          ).join('');

          const absentBadge = ignored
            ? ' <span class="badge badge-absent">Absent</span>'
            : '';

          return `
            <tr data-player-row="${player.id}" class="${ignored ? 'vs-row-absent' : ''}">
              <td><strong>${escapeHtml(player.pseudo)}</strong>${absentBadge}</td>
              <td>${escapeHtml(player.role)}</td>
              ${dayCells}
              ${donationCellHtml(
                player.id,
                ignored ? false : localScore.allianceDonMissed,
                rowEditable,
                cfg.donationPenalty
              )}
              <td class="vs-indicator-cell" data-under-for="${player.id}">${under} / 5</td>
              <td class="vs-indicator-cell" data-met-for="${player.id}">${met} / 5</td>
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

    const state = ROSStorage.getState();
    const week = getSelectedWeek();
    if (!week) return;
    const score = week.scores[playerId] || ROSModels.createEmptyScore();
    const total = ROSModels.computeTotal(score, state);
    const color = ROSModels.getColorClass(total, state);
    const under = ROSModels.countDaysUnderObjective(score);
    const met = ROSModels.countObjectivesMet(score);

    const cell = els.tbody.querySelector(`[data-total-for="${playerId}"]`);
    if (cell) {
      cell.textContent = String(total);
      cell.classList.remove('color-green', 'color-orange', 'color-red');
      cell.classList.add(color);
    }
    const underCell = els.tbody.querySelector(`[data-under-for="${playerId}"]`);
    if (underCell) underCell.textContent = `${under} / 5`;
    const metCell = els.tbody.querySelector(`[data-met-for="${playerId}"]`);
    if (metCell) metCell.textContent = `${met} / 5`;
  }

  function syncSideViews() {
    if (global.CommandModule) CommandModule.render();
    if (global.PlayersModule) PlayersModule.render();
    if (global.ArchivesModule) ArchivesModule.render();
    if (global.NotificationsModule) NotificationsModule.render();
  }

  function updateDay(playerId, dayKey, bracket) {
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

    const safeBracket = ROSModels.VS_BRACKETS.includes(bracket)
      ? bracket
      : ROSModels.inferDayBracket(bracket);
    const points = ROSModels.pointsForBracket(safeBracket, state);

    ROSStorage.update(
      (s) => {
        const target = s.weeks.find((w) => w.id === weekId);
        if (!ROSModels.isWeekEditable(target, s.currentWeekId)) return s;
        const score = ROSModels.ensurePlayerScore(target, playerId);
        score.dayBrackets[dayKey] = safeBracket;
        score.days[dayKey] = points;
        return s;
      },
      { silent: true }
    );
    refreshRowTotal(playerId);
    syncSideViews();
  }

  function updateDonation(playerId, missed) {
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
        score.allianceDonMissed = Boolean(missed);
        return s;
      },
      { silent: true }
    );
    refreshRowTotal(playerId);
    syncSideViews();
  }

  function nextAvailableMonday() {
    const state = ROSStorage.getState();
    const used = new Set((state.weeks || []).map((w) => w.startDate));
    let cursor = ROSModels.startOfWeekMonday(new Date());
    for (let i = 0; i < 104; i += 1) {
      const iso = ROSModels.toISODate(cursor);
      if (!used.has(iso)) return cursor;
      cursor = ROSModels.addDays(cursor, 7);
    }
    return ROSModels.startOfWeekMonday(new Date());
  }

  function stampClosedWeek(week) {
    week.archived = true;
    week.closedAt = new Date().toISOString();
    const actor =
      global.ROSProfiles && typeof ROSProfiles.stampActor === 'function'
        ? ROSProfiles.stampActor()
        : { actorUserId: '', actorPlayerId: null, actorLabel: '' };
    week.closedByUserId = actor.actorUserId || '';
    week.closedByPlayerId = actor.actorPlayerId || null;
    week.closedBy = actor.actorLabel || '';
  }

  /**
   * Snapshot d’absence à la clôture : chaque actif a une entrée ;
   * absents → score 0 + absent:true (historique indépendant de player.absent).
   */
  function snapshotAbsencesOnClose(week, players) {
    (players || [])
      .filter((p) => p.status === 'Actif')
      .forEach((player) => {
        if (player.absent) {
          week.scores[player.id] = ROSModels.createEmptyScore({ absent: true });
          return;
        }
        const existing = week.scores[player.id] || ROSModels.createEmptyScore();
        ROSModels.ensureDayBrackets(existing);
        existing.absent = false;
        week.scores[player.id] = existing;
      });
  }

  async function closeActiveWeek() {
    const state = ROSStorage.getState();
    const current = getActiveWeek(state);
    if (!current) {
      AppUI.toast('Aucune semaine VS active à clôturer.');
      return;
    }

    const ok = await AppUI.confirm({
      title: 'Clôturer la semaine VS',
      message:
        'Clôturer la semaine active ? Elle restera dans l’historique (lecture seule). Aucune nouvelle semaine ne sera créée automatiquement.',
      confirmLabel: 'Clôturer',
    });
    if (!ok) return;

    const closedId = current.id;
    ROSStorage.update((s) => {
      const week = s.weeks.find((w) => w.id === s.currentWeekId);
      if (!week || week.id !== closedId) return s;
      snapshotAbsencesOnClose(week, s.players);
      stampClosedWeek(week);
      s.currentWeekId = null;
      return s;
    });

    if (els.weekSelector) els.weekSelector.value = closedId;
    render();
    syncSideViews();
    AppUI.toast('Semaine VS clôturée. Aucune semaine active.');
  }

  async function createNewWeek() {
    const state = ROSStorage.getState();
    const current = getActiveWeek(state);
    if (current) {
      AppUI.toast('Clôturez d’abord la semaine VS active avant d’en créer une nouvelle.');
      return;
    }

    const ok = await AppUI.confirm({
      title: 'Nouvelle semaine VS',
      message:
        'Créer une nouvelle semaine VS suivie ? Elle sera la seule semaine active et éditable.',
      confirmLabel: 'Créer',
    });
    if (!ok) return;

    const startDateObj = nextAvailableMonday();

    ROSStorage.update((s) => {
      s.vsSettings = ROSModels.normalizeVsSettings({
        ...ROSModels.getVsSettings(s),
        mode: 'afond',
      });

      const week = ROSModels.createWeek(startDateObj, {
        number: ROSModels.getNextWeekNumber(s.weeks),
        archived: false,
      });

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
    render();
    syncSideViews();
    AppUI.toast('Nouvelle semaine VS créée.');
  }

  function saveSettings(event) {
    event.preventDefault();
    if (!canEditVsSettings()) {
      AppUI.toast('Seul le R5 peut modifier les paramètres VS.');
      return;
    }
    const num = (id) => Number(document.getElementById(id)?.value);

    ROSStorage.update((s) => {
      const previous = ROSModels.getVsSettings(s);
      s.vsSettings = ROSModels.normalizeVsSettings({
        mode: 'afond',
        afond: {
          dailyGoal: num('vsAfondDailyGoal'),
          midMin: num('vsAfondMidMin'),
          midPoints: num('vsAfondMidPoints'),
          lowPoints: num('vsAfondLowPoints'),
          donationPenalty: num('vsAfondDonation'),
          redFrom: num('vsAfondRedFrom'),
        },
        // Conserve le barème ECO stocké (lecture historique) sans l’exposer dans l’UI.
        eco: previous.eco,
      });
      const active = s.weeks.find((w) => w.id === s.currentWeekId);
      if (active && !active.archived) {
        ROSModels.recalculateWeekWithBareme(active, s);
      }
      return s;
    });

    render();
    syncSideViews();
    void confirmVsSettingsSaved();
  }

  async function confirmVsSettingsSaved() {
    if (!global.ROSSync || typeof ROSSync.flushPush !== 'function') {
      AppUI.toast('Paramètres VS enregistrés.');
      return;
    }
    const result = await ROSSync.flushPush();
    if (result?.ok || result?.reason === 'noop' || result?.reason === 'local-runtime') {
      AppUI.toast('Paramètres VS enregistrés.');
      return;
    }
    if (result?.reason === 'conflict') return;
    if (result?.reason === 'offline') {
      AppUI.toast('Hors connexion — paramètres conservés localement.');
    }
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
    els.btnNewWeek?.addEventListener('click', createNewWeek);
    els.btnCloseWeek?.addEventListener('click', closeActiveWeek);
    els.weekSelector?.addEventListener('change', render);
    els.tbody?.addEventListener('change', onTableChange);
    els.settingsForm?.addEventListener('submit', saveSettings);
  }

  global.VSModule = {
    init,
    render,
    renderSettings,
    getSelectedWeek,
    getActiveWeek,
    createNewWeek,
    closeActiveWeek,
    snapshotAbsencesOnClose,
    canEditVsSettings,
  };
})(window);
