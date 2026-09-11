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
    const thresholds = ROSModels.getColorThresholds(settings);
    const orangeMax = Math.max(thresholds.orangeFrom, thresholds.redFrom - 1);

    const optionItems = options
      .map((opt) => {
        const swatch =
          opt.bracket === 'high' || opt.bracket === 'ok'
            ? '0'
            : opt.bracket === 'mid'
              ? '5'
              : '10';
        return `<span class="legend-item"><span class="swatch score-${swatch}"></span> ${escapeHtml(
          opt.label
        )}</span>`;
      })
      .join('');

    els.legend.innerHTML = `
      ${optionItems}
      <span class="legend-item"><span class="dot color-green"></span> 0–${
        thresholds.orangeFrom - 1
      } j sous</span>
      <span class="legend-item"><span class="dot color-orange"></span> ${
        thresholds.orangeFrom
      }–${orangeMax} j sous</span>
      <span class="legend-item"><span class="dot color-red"></span> ≥ ${
        thresholds.redFrom
      } j sous</span>
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
    // Une seule semaine éventuelle (active) — plus d’archives consultables.
    els.weekSelector.innerHTML = weeks
      .map((week) => {
        const mark = week.id === state.currentWeekId ? ' — active' : '';
        return `<option value="${week.id}">${escapeHtml(
          week.label || `Semaine ${week.number}`
        )}${mark}</option>`;
      })
      .join('');

    if (!weeks.length) {
      els.weekSelector.innerHTML = '<option value="">Aucune semaine</option>';
      els.weekSelector.value = '';
    } else if (weeks.some((w) => w.id === previousSelectedId)) {
      els.weekSelector.value = previousSelectedId;
    } else if (state.currentWeekId && weeks.some((w) => w.id === state.currentWeekId)) {
      els.weekSelector.value = state.currentWeekId;
    } else if (weeks[0]) {
      els.weekSelector.value = weeks[0].id;
    }

    const selected = getSelectedWeek();
    const editable = ROSModels.isWeekEditable(selected, state.currentWeekId);

    if (els.noActiveNotice) {
      if (!active) {
        els.noActiveNotice.classList.remove('hidden');
        els.noActiveNotice.textContent =
          'Aucune semaine VS active. Créez une semaine lorsque vous jouez le VS à fond.';
      } else {
        els.noActiveNotice.classList.add('hidden');
      }
    }

    if (els.archiveNotice) {
      els.archiveNotice.classList.add('hidden');
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

  function playersForWeek(week, editable) {
    const state = ROSStorage.getState();
    if (!week) return [];

    if (editable) {
      return state.players
        .filter((p) => p.status === 'Actif' && !p.absent)
        .sort((a, b) => a.pseudo.localeCompare(b.pseudo, 'fr', { sensitivity: 'base' }));
    }

    const ids = Object.keys(week.scores || {});
    return ids
      .map((id) => state.players.find((p) => p.id === id) || { id, pseudo: 'Joueur retiré', role: '—' })
      .filter((p) => !p.absent)
      .sort((a, b) => a.pseudo.localeCompare(b.pseudo, 'fr', { sensitivity: 'base' }));
  }

  function ensureActiveScores(weekId, playerIds) {
    const state = ROSStorage.getState();
    if (weekId !== state.currentWeekId) return;

    const week = state.weeks.find((w) => w.id === weekId);
    if (!week || week.archived) return;

    const presentIds = new Set(playerIds);
    const missing = playerIds.filter((id) => !week.scores[id]);
    const orphanAbsent = Object.keys(week.scores || {}).filter((id) => !presentIds.has(id));
    if (!missing.length && !orphanAbsent.length) return;

    ROSStorage.update(
      (s) => {
        const target = s.weeks.find((w) => w.id === weekId);
        if (!target || target.id !== s.currentWeekId) return s;
        orphanAbsent.forEach((id) => {
          delete target.scores[id];
        });
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
    setVal('vsAfondPraiseGoal', settings.afond.praiseGoal);
    setVal('vsAfondMidMin', settings.afond.midMin);

    const editable = canEditVsSettings();
    ['vsAfondDailyGoal', 'vsAfondPraiseGoal', 'vsAfondMidMin'].forEach((id) => {
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
          const under = ROSModels.countDaysUnderObjective(localScore);
          const met = ROSModels.countObjectivesMet(localScore);
          const color = ROSModels.getColorClass(under, freshState);
          const rowEditable = editable;

          const dayCells = ROSModels.DAYS.map((day) =>
            dayCellHtml(
              player.id,
              day.key,
              localScore.days[day.key],
              localScore.dayBrackets[day.key],
              rowEditable,
              freshState
            )
          ).join('');

          return `
            <tr data-player-row="${player.id}">
              <td><strong>${escapeHtml(player.pseudo)}</strong></td>
              <td>${escapeHtml(player.role)}</td>
              ${dayCells}
              <td class="vs-indicator-cell ${color}" data-under-for="${player.id}">${under} / 5</td>
              <td class="vs-indicator-cell" data-met-for="${player.id}">${met} / 5</td>
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
    if (!player || player.absent) return;

    const state = ROSStorage.getState();
    const week = getSelectedWeek();
    if (!week) return;
    const score = week.scores[playerId] || ROSModels.createEmptyScore();
    const under = ROSModels.countDaysUnderObjective(score);
    const met = ROSModels.countObjectivesMet(score);
    const color = ROSModels.getColorClass(under, state);

    const underCell = els.tbody.querySelector(`[data-under-for="${playerId}"]`);
    if (underCell) {
      underCell.textContent = `${under} / 5`;
      underCell.classList.remove('color-green', 'color-orange', 'color-red');
      underCell.classList.add(color);
    }
    const metCell = els.tbody.querySelector(`[data-met-for="${playerId}"]`);
    if (metCell) metCell.textContent = `${met} / 5`;
  }

  function syncSideViews() {
    if (global.CommandModule) CommandModule.render();
    if (global.PlayersModule) PlayersModule.render();
    if (global.NotificationsModule) NotificationsModule.render();
    if (global.SuiviModule) SuiviModule.render();
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
   * À la clôture : ne garder que les présents (les absents sont hors VS / hors compteurs).
   */
  function snapshotAbsencesOnClose(week, players) {
    const presentIds = new Set(
      (players || []).filter((p) => p.status === 'Actif' && !p.absent).map((p) => p.id)
    );
    Object.keys(week.scores || {}).forEach((id) => {
      if (!presentIds.has(id)) delete week.scores[id];
    });
    presentIds.forEach((id) => {
      const existing = week.scores[id] || ROSModels.createEmptyScore();
      ROSModels.ensureDayBrackets(existing);
      existing.absent = false;
      week.scores[id] = existing;
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
        'Clôturer la semaine active ? Les scores détaillés seront effacés. Un compteur léger « semaines sous seuil / à féliciter » est conservé par joueur (8 dernières). Les absents ne sont pas comptés. Aucune nouvelle semaine ne sera créée automatiquement.',
      confirmLabel: 'Clôturer et effacer',
    });
    if (!ok) return;

    const closedId = current.id;
    ROSStorage.update((s) => {
      const week = s.weeks.find((w) => w.id === s.currentWeekId);
      if (!week || week.id !== closedId) return s;
      ROSModels.recordVsUnderSnapshotsForWeek(s, week);
      s.weeks = (s.weeks || []).filter((w) => w.id !== closedId);
      s.currentWeekId = null;
      if (s.playerWeekNotes && typeof s.playerWeekNotes === 'object') {
        Object.keys(s.playerWeekNotes).forEach((playerId) => {
          const byWeek = s.playerWeekNotes[playerId];
          if (!byWeek || typeof byWeek !== 'object') return;
          delete byWeek[closedId];
          if (!Object.keys(byWeek).length) delete s.playerWeekNotes[playerId];
        });
      }
      return s;
    });

    if (els.weekSelector) els.weekSelector.value = '';
    render();
    syncSideViews();
    AppUI.toast('Semaine VS clôturée. Compteur sous seuil mis à jour.');
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
        .filter((p) => p.status === 'Actif' && !p.absent)
        .forEach((p) => {
          week.scores[p.id] = ROSModels.createEmptyScore();
        });

      s.weeks.unshift(week);
      s.currentWeekId = week.id;
      // Nouvelle semaine : réactive la détection VS / félicitations après un reset.
      const prevFollow = ROSModels.getFollowUpSettings(s);
      if (prevFollow.vsFollowUpMutedWeekId) {
        s.followUpSettings = ROSModels.normalizeFollowUpSettings({
          ...prevFollow,
          vsFollowUpMutedWeekId: null,
        });
      }
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
          praiseGoal: num('vsAfondPraiseGoal'),
          midMin: num('vsAfondMidMin'),
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
