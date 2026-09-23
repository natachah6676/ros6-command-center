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
    els.contactFilter = document.getElementById('vsContactFilter');
    els.pastUnderList = document.getElementById('vsPastUnderList');
    els.pastUnderEmpty = document.getElementById('vsPastUnderEmpty');
    els.pastUnderHint = document.getElementById('vsPastUnderHint');
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

  function canMarkVsContact() {
    return Boolean(
      global.ROSProfiles &&
        typeof ROSProfiles.isActiveR4OrR5 === 'function' &&
        ROSProfiles.isActiveR4OrR5()
    );
  }

  function stampActor() {
    if (global.ROSProfiles && typeof ROSProfiles.stampActor === 'function') {
      return ROSProfiles.stampActor();
    }
    return { actorUserId: '', actorPlayerId: null, actorLabel: '' };
  }

  function getEffectiveContact(week, playerId, signal) {
    if (!signal || !week) return null;
    const contacts = ROSModels.normalizeVsWeekContacts(week.vsContacts);
    const contact = contacts[playerId];
    if (!contact || contact.kind !== signal) return null;
    return contact;
  }

  function contactedLabel(signal) {
    if (signal === 'coach') return 'Coaché';
    if (signal === 'praise') return 'Félicité';
    return 'Contacté';
  }

  function renderPastUnderHistory(state) {
    if (!els.pastUnderList) return;
    const history = ROSModels.normalizeVsUnderWeekHistory(state.vsUnderWeekHistory);
    const minDays = ROSModels.getFollowUpSettings(state).vsMinUnderDays;
    if (els.pastUnderHint) {
      els.pastUnderHint.textContent = `Joueurs avec ≥ ${minDays} j sous objectif à la clôture (paramètre suivi).`;
    }
    if (!history.length) {
      els.pastUnderList.innerHTML = '';
      if (els.pastUnderEmpty) els.pastUnderEmpty.classList.remove('hidden');
      return;
    }
    if (els.pastUnderEmpty) els.pastUnderEmpty.classList.add('hidden');
    els.pastUnderList.innerHTML = history
      .map((entry) => {
        const when =
          ROSModels.formatCoachingDateTime(entry.closedAt) ||
          ROSModels.formatDateFR(entry.startDate) ||
          entry.weekLabel ||
          'Semaine';
        const rows = (entry.players || [])
          .map((p) => {
            const contactBit = p.contacted
              ? ` · Coaché${p.contactedBy ? ` par ${escapeHtml(p.contactedBy)}` : ''}`
              : '';
            return `<li><strong>${escapeHtml(p.pseudo)}</strong> — ${p.underDays} j sous${contactBit}</li>`;
          })
          .join('');
        return `
          <article class="vs-past-under-week">
            <header>
              <strong>${escapeHtml(entry.weekLabel || 'Semaine')}</strong>
              <span class="panel-subtitle">${escapeHtml(when)} · seuil ≥ ${entry.underMinDays} j</span>
            </header>
            ${
              rows
                ? `<ul class="vs-past-under-players">${rows}</ul>`
                : '<p class="panel-subtitle">Aucun joueur sous seuil.</p>'
            }
          </article>
        `;
      })
      .join('');
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
        renderPastUnderHistory(state);
        return;
      }

      if (!players.length) {
        els.tbody.innerHTML = '';
        els.table.classList.add('hidden');
        els.empty.classList.remove('hidden');
        els.empty.textContent = editable
          ? 'Aucun joueur actif. Ajoutez des joueurs pour saisir le VS.'
          : 'Aucun snapshot pour cette semaine archivée.';
        renderPastUnderHistory(state);
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
      const contactFilter = els.contactFilter?.value || '';
      const canContact = canMarkVsContact() && editable;

      const filteredPlayers = players.filter((player) => {
        const localScore = freshWeek.scores[player.id] || ROSModels.createEmptyScore();
        ROSModels.ensureDayBrackets(localScore);
        const signal = ROSModels.getVsWeekSignal(localScore, freshState);
        const contact = getEffectiveContact(freshWeek, player.id, signal);
        if (contactFilter === 'coach') return signal === 'coach' && !contact;
        if (contactFilter === 'praise') return signal === 'praise' && !contact;
        if (contactFilter === 'contacted') return Boolean(contact);
        return true;
      });

      if (!filteredPlayers.length) {
        els.tbody.innerHTML = '';
        els.table.classList.remove('hidden');
        els.empty.classList.remove('hidden');
        els.empty.textContent =
          contactFilter === 'coach'
            ? 'Aucun joueur à coacher avec les scores actuels.'
            : contactFilter === 'praise'
              ? 'Aucun joueur à féliciter avec les scores actuels.'
              : contactFilter === 'contacted'
                ? 'Aucun contact enregistré pour cette semaine.'
                : 'Aucun joueur actif. Ajoutez des joueurs pour saisir le VS.';
        renderPastUnderHistory(freshState);
        return;
      }

      els.table.classList.remove('hidden');
      els.empty.classList.add('hidden');

      els.tbody.innerHTML = filteredPlayers
        .map((player) => {
          const localScore = freshWeek.scores[player.id] || ROSModels.createEmptyScore();
          ROSModels.ensureDayBrackets(localScore);
          const signal = ROSModels.getVsWeekSignal(localScore, freshState);
          const contact = getEffectiveContact(freshWeek, player.id, signal);
          const rowEditable = editable;
          const under = ROSModels.countDaysUnderObjective(localScore);
          const color = ROSModels.getColorClass(under, freshState);

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

          let signalHtml = `<span class="vs-signal vs-signal--none">—</span>`;
          if (signal === 'coach') {
            signalHtml = `<span class="vs-signal vs-signal--coach ${color}">À coacher</span>`;
          } else if (signal === 'praise') {
            signalHtml = `<span class="vs-signal vs-signal--praise">À féliciter</span>`;
          }

          let contactHtml = '—';
          if (contact) {
            const when =
              ROSModels.formatCoachingDateTime(contact.at) ||
              contact.at ||
              '';
            const who = contact.authorLabel ? ` · ${escapeHtml(contact.authorLabel)}` : '';
            contactHtml = `<span class="vs-contact-done" data-contact-for="${escapeHtml(
              player.id
            )}">${escapeHtml(contactedLabel(signal))}${
              when ? ` · ${escapeHtml(when)}` : ''
            }${who}</span>`;
          } else if (signal && canContact) {
            contactHtml = `<button type="button" class="btn btn-primary btn-sm" data-vs-contact="${escapeHtml(
              player.id
            )}" data-vs-contact-kind="${escapeHtml(signal)}">Contacté</button>`;
          } else if (signal) {
            contactHtml = `<span class="panel-subtitle">À contacter</span>`;
          }

          return `
            <tr data-player-row="${player.id}">
              <td><strong>${escapeHtml(player.pseudo)}</strong></td>
              ${dayCells}
              <td class="vs-signal-cell" data-signal-for="${player.id}">${signalHtml}</td>
              <td class="vs-contact-cell" data-contact-cell-for="${player.id}">${contactHtml}</td>
            </tr>
          `;
        })
        .join('');
      renderPastUnderHistory(freshState);
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
    const signal = ROSModels.getVsWeekSignal(score, state);
    const contact = getEffectiveContact(week, playerId, signal);
    const under = ROSModels.countDaysUnderObjective(score);
    const color = ROSModels.getColorClass(under, state);
    const canContact = canMarkVsContact();

    const signalCell = els.tbody?.querySelector(`[data-signal-for="${playerId}"]`);
    if (signalCell) {
      if (signal === 'coach') {
        signalCell.innerHTML = `<span class="vs-signal vs-signal--coach ${color}">À coacher</span>`;
      } else if (signal === 'praise') {
        signalCell.innerHTML = `<span class="vs-signal vs-signal--praise">À féliciter</span>`;
      } else {
        signalCell.innerHTML = `<span class="vs-signal vs-signal--none">—</span>`;
      }
    }

    const contactCell = els.tbody?.querySelector(`[data-contact-cell-for="${playerId}"]`);
    if (contactCell) {
      if (contact) {
        const when = ROSModels.formatCoachingDateTime(contact.at) || contact.at || '';
        const who = contact.authorLabel ? ` · ${escapeHtml(contact.authorLabel)}` : '';
        contactCell.innerHTML = `<span class="vs-contact-done">${escapeHtml(
          contactedLabel(signal)
        )}${when ? ` · ${escapeHtml(when)}` : ''}${who}</span>`;
      } else if (signal && canContact) {
        contactCell.innerHTML = `<button type="button" class="btn btn-primary btn-sm" data-vs-contact="${escapeHtml(
          playerId
        )}" data-vs-contact-kind="${escapeHtml(signal)}">Contacté</button>`;
      } else if (signal) {
        contactCell.innerHTML = `<span class="panel-subtitle">À contacter</span>`;
      } else {
        contactCell.textContent = '—';
      }
    }

    // Si un filtre est actif, un changement de score peut faire sortir la ligne.
    const contactFilter = els.contactFilter?.value || '';
    if (contactFilter) render();
  }

  function markVsContact(playerId, kind) {
    if (!canMarkVsContact()) {
      AppUI.toast('Seul un R4 ou R5 peut noter un contact VS.');
      return;
    }
    if (kind !== 'coach' && kind !== 'praise') return;
    const state = ROSStorage.getState();
    const week = getActiveWeek(state);
    if (!week || !ROSModels.isWeekEditable(week, state.currentWeekId)) {
      AppUI.toast('Contact possible uniquement sur la semaine VS active.');
      return;
    }
    const score = week.scores?.[playerId];
    const signal = ROSModels.getVsWeekSignal(score, state);
    if (signal !== kind) {
      AppUI.toast('Le signal a changé — actualisez la ligne.');
      render();
      return;
    }
    const actor = stampActor();
    ROSStorage.update((s) => {
      const target = s.weeks.find((w) => w.id === week.id);
      if (!target || !ROSModels.isWeekEditable(target, s.currentWeekId)) return s;
      if (!target.vsContacts || typeof target.vsContacts !== 'object') target.vsContacts = {};
      target.vsContacts[playerId] = ROSModels.normalizeVsWeekContact({
        kind,
        at: new Date().toISOString(),
        authorLabel: actor.actorLabel || '',
        authorUserId: actor.actorUserId || '',
      });
      return s;
    });
    AppUI.toast(kind === 'praise' ? 'Félicitations notées.' : 'Contact coaching noté.');
    render();
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
    return actor;
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
        'Clôturer la semaine active ? Les scores détaillés seront effacés. Un résumé « sous seuil » (selon le paramètre, ex. ≥ 2 j) est conservé dans Semaines passées, ainsi qu’un compteur léger par joueur. Les absents ne sont pas comptés.',
      confirmLabel: 'Clôturer et effacer',
    });
    if (!ok) return;

    const closedId = current.id;
    ROSStorage.update((s) => {
      const week = s.weeks.find((w) => w.id === s.currentWeekId);
      if (!week || week.id !== closedId) return s;
      const closer = stampClosedWeek(week);
      ROSModels.recordVsUnderSnapshotsForWeek(s, week);
      ROSModels.pushVsUnderWeekArchive(s, week);
      ROSModels.pushVsWeekAudit(
        s,
        ROSModels.buildVsWeekAuditEntry('close', week, closer, week.closedAt)
      );
      s.vsWeekLifecycle = {
        closeIntent: {
          weekId: closedId,
          closedAt: week.closedAt || new Date().toISOString(),
        },
      };
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
    AppUI.toast('Semaine VS clôturée — résumé sous seuil archivé.');
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

      const creator = stampActor();
      const week = ROSModels.createWeek(startDateObj, {
        number: ROSModels.getNextWeekNumber(s.weeks),
        archived: false,
        actor: creator,
      });

      s.players
        .filter((p) => p.status === 'Actif' && !p.absent)
        .forEach((p) => {
          week.scores[p.id] = ROSModels.createEmptyScore();
        });

      s.weeks.unshift(week);
      s.currentWeekId = week.id;
      ROSModels.pushVsWeekAudit(
        s,
        ROSModels.buildVsWeekAuditEntry('create', week, creator, week.createdAt)
      );
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

  function onTableClick(event) {
    const btn = event.target.closest('[data-vs-contact]');
    if (!btn) return;
    markVsContact(btn.dataset.vsContact, btn.dataset.vsContactKind);
  }

  function init() {
    cacheDom();
    els.btnNewWeek?.addEventListener('click', createNewWeek);
    els.btnCloseWeek?.addEventListener('click', closeActiveWeek);
    els.weekSelector?.addEventListener('change', render);
    els.contactFilter?.addEventListener('change', render);
    els.tbody?.addEventListener('change', onTableChange);
    els.tbody?.addEventListener('click', onTableClick);
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
