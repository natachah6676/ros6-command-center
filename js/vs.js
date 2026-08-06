/**
 * Module VS hebdomadaire — gestion sécurisée des semaines
 * Modes VS ÉCO / VS À FOND · paramètres · indicateurs · clôture sécurisée
 */
(function (global) {
  const els = {};
  let rendering = false;
  let settingsTab = 'afond';

  function cacheDom() {
    els.weekSelector = document.getElementById('weekSelector');
    els.btnNewWeek = document.getElementById('btnNewWeek');
    els.tbody = document.getElementById('vsTableBody');
    els.empty = document.getElementById('vsEmpty');
    els.table = document.getElementById('vsTable');
    els.activeTitle = document.getElementById('vsActiveWeekTitle');
    els.activeDates = document.getElementById('vsActiveWeekDates');
    els.archiveNotice = document.getElementById('vsArchiveNotice');
    els.modeBar = document.getElementById('vsModeBar');
    els.modeLabel = document.getElementById('vsModeLabel');
    els.btnToggleMode = document.getElementById('vsToggleMode');
    els.btnOpenSettings = document.getElementById('btnVsSettings');
    els.btnBackFromSettings = document.getElementById('btnVsBackFromSettings');
    els.mainView = document.getElementById('vsMainView');
    els.settingsView = document.getElementById('vsSettingsView');
    els.legend = document.getElementById('vsLegend');
    els.donationsCheck = document.getElementById('vsDonationsVerified');
    els.donationsWrap = document.getElementById('vsDonationsVerifiedWrap');
    els.settingsPaneAfond = document.getElementById('vsSettingsPaneAfond');
    els.settingsPaneEco = document.getElementById('vsSettingsPaneEco');
    els.settingsForm = document.getElementById('vsSettingsForm');
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

  function modeLabel(mode) {
    return mode === 'afond' ? 'VS À FOND' : 'VS ÉCO';
  }

  function showSettingsView(show) {
    if (els.mainView) els.mainView.classList.toggle('hidden', show);
    if (els.settingsView) els.settingsView.classList.toggle('hidden', !show);
  }

  function renderModeBar(state) {
    const settings = ROSModels.getVsSettings(state);
    const isAfond = settings.mode === 'afond';
    if (els.modeLabel) {
      els.modeLabel.innerHTML = isAfond
        ? '🔴 Mode actuel : <strong>VS À FOND</strong>'
        : '🟢 Mode actuel : <strong>VS ÉCO</strong>';
    }
    if (els.btnToggleMode) {
      els.btnToggleMode.textContent = isAfond ? 'Revenir en VS ÉCO' : 'Passer en VS À FOND';
      els.btnToggleMode.dataset.targetMode = isAfond ? 'eco' : 'afond';
    }
    if (els.modeBar) {
      els.modeBar.classList.toggle('vs-mode-afond', isAfond);
      els.modeBar.classList.toggle('vs-mode-eco', !isAfond);
    }
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

    if (els.donationsWrap) {
      els.donationsWrap.classList.toggle('hidden', !editable);
    }
    if (els.donationsCheck) {
      els.donationsCheck.checked = Boolean(selected?.donationsVerified);
      els.donationsCheck.disabled = !editable;
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
    setVal('vsEcoDailyGoal', settings.eco.dailyGoal);
    setVal('vsEcoUnderPoints', settings.eco.underPoints);
    setVal('vsEcoDonation', settings.eco.donationPenalty);
    setVal('vsEcoRedFrom', settings.eco.redFrom);
  }

  function switchSettingsTab(tab) {
    settingsTab = tab === 'eco' ? 'eco' : 'afond';
    document.querySelectorAll('[data-vs-settings-tab]').forEach((btn) => {
      const active = btn.dataset.vsSettingsTab === settingsTab;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    els.settingsPaneAfond?.classList.toggle('hidden', settingsTab !== 'afond');
    els.settingsPaneEco?.classList.toggle('hidden', settingsTab !== 'eco');
  }

  function render() {
    if (rendering) return;
    rendering = true;

    try {
      const state = ROSStorage.getState();
      renderModeBar(state);
      renderLegend(state);
      renderWeekBar();
      fillSettingsForm(state);
      switchSettingsTab(settingsTab);

      const week = getSelectedWeek();
      const editable = ROSModels.isWeekEditable(week, state.currentWeekId);
      const players = playersForWeek(week, editable);
      const cfg = ROSModels.getActiveVsConfig(state);

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
          const ignored = Boolean(player.absent) && editable;
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

          const absentBadge = player.absent
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
    const state = ROSStorage.getState();
    const current = getActiveWeek(state);
    if (current && !current.donationsVerified) {
      await AppUI.confirm({
        title: 'Vérification des dons',
        message: 'Les dons d’alliance ont-ils bien été vérifiés pour tous les joueurs ?',
        confirmLabel: 'Retour au tableau',
      });
      return;
    }

    const ok = await AppUI.confirm({
      title: 'Créer la semaine suivante',
      message: 'Créer la semaine suivante ? La semaine actuelle sera automatiquement archivée.',
      confirmLabel: 'Créer',
    });
    if (!ok) return;

    const startDateObj = nextAvailableMonday();

    ROSStorage.update((s) => {
      const currentWeek = s.weeks.find((w) => w.id === s.currentWeekId);
      if (currentWeek) {
        currentWeek.archived = true;
        currentWeek.closedAt = new Date().toISOString();
        const actor =
          global.ROSProfiles && typeof ROSProfiles.stampActor === 'function'
            ? ROSProfiles.stampActor()
            : { actorUserId: '', actorPlayerId: null, actorLabel: '' };
        currentWeek.closedByUserId = actor.actorUserId || '';
        currentWeek.closedByPlayerId = actor.actorPlayerId || null;
        currentWeek.closedBy = actor.actorLabel || '';
      }

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
    AppUI.toast('Nouvelle semaine créée. La précédente est archivée.');
  }

  async function toggleMode() {
    const state = ROSStorage.getState();
    const settings = ROSModels.getVsSettings(state);
    const target = els.btnToggleMode?.dataset.targetMode === 'afond' ? 'afond' : 'eco';
    const fromLabel = modeLabel(settings.mode);
    const toLabel = modeLabel(target);

    const ok = await AppUI.confirm({
      title: `Passer en ${toLabel}`,
      message: `Confirmer le passage de ${fromLabel} vers ${toLabel} ? Les pénalités de la semaine active seront recalculées avec le barème ${toLabel}.`,
      confirmLabel: 'Confirmer',
    });
    if (!ok) return;

    ROSStorage.update((s) => {
      s.vsSettings = ROSModels.normalizeVsSettings({
        ...ROSModels.getVsSettings(s),
        mode: target,
      });
      const active = s.weeks.find((w) => w.id === s.currentWeekId);
      if (active && !active.archived) {
        ROSModels.recalculateWeekWithBareme(active, s);
      }
      return s;
    });

    AppUI.toast(`Mode ${toLabel} activé — pénalités recalculées.`);
    render();
    syncSideViews();
  }

  function saveSettings(event) {
    event.preventDefault();
    const readNum = (id) => Number(document.getElementById(id)?.value);

    ROSStorage.update((s) => {
      s.vsSettings = ROSModels.normalizeVsSettings({
        mode: ROSModels.getVsSettings(s).mode,
        afond: {
          dailyGoal: readNum('vsAfondDailyGoal'),
          midMin: readNum('vsAfondMidMin'),
          midPoints: readNum('vsAfondMidPoints'),
          lowPoints: readNum('vsAfondLowPoints'),
          donationPenalty: readNum('vsAfondDonation'),
          redFrom: readNum('vsAfondRedFrom'),
        },
        eco: {
          dailyGoal: readNum('vsEcoDailyGoal'),
          underPoints: readNum('vsEcoUnderPoints'),
          donationPenalty: readNum('vsEcoDonation'),
          redFrom: readNum('vsEcoRedFrom'),
        },
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
    if (result?.ok || result?.reason === 'noop') {
      AppUI.toast('Paramètres VS enregistrés.');
      return;
    }
    if (result?.reason === 'conflict') return;
    if (result?.reason === 'offline') {
      AppUI.toast('Hors connexion — paramètres conservés localement.');
    }
  }

  function onDonationsVerifiedChange() {
    if (!isSelectedEditable()) {
      render();
      return;
    }
    const checked = Boolean(els.donationsCheck?.checked);
    const weekId = els.weekSelector.value;
    ROSStorage.update(
      (s) => {
        const target = s.weeks.find((w) => w.id === weekId);
        if (!ROSModels.isWeekEditable(target, s.currentWeekId)) return s;
        target.donationsVerified = checked;
        return s;
      },
      { silent: true }
    );
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
    els.btnToggleMode?.addEventListener('click', toggleMode);
    els.btnOpenSettings?.addEventListener('click', () => {
      fillSettingsForm(ROSStorage.getState());
      showSettingsView(true);
    });
    els.btnBackFromSettings?.addEventListener('click', () => showSettingsView(false));
    els.donationsCheck?.addEventListener('change', onDonationsVerifiedChange);
    els.settingsForm?.addEventListener('submit', saveSettings);
    document.querySelectorAll('[data-vs-settings-tab]').forEach((btn) => {
      btn.addEventListener('click', () => switchSettingsTab(btn.dataset.vsSettingsTab));
    });
    showSettingsView(false);
  }

  global.VSModule = { init, render, getSelectedWeek, getActiveWeek };
})(window);
