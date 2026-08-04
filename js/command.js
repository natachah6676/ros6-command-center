/**
 * Poste de Commandement — consultation seule
 * + checklist hebdo Puissance héros MAJ
 * + Coaching prioritaire (tranches 25–30 / 30–35)
 */
(function (global) {
  const WEEKLY_ACTION_ID = 'hero_power_maj';
  const WEEKLY_ACTION_LABEL = 'Puissance héros MAJ';
  const HISTORY_LIMIT = 16;

  const els = {};

  function cacheDom() {
    els.weekLabel = document.getElementById('commandWeekLabel');
    els.kpis = document.getElementById('commandKpis');
    els.weeklyChecklist = document.getElementById('commandWeeklyChecklist');
    els.weeklyHistory = document.getElementById('commandWeeklyHistory');
    els.contactList = document.getElementById('commandContactList');
    els.contactEmpty = document.getElementById('commandContactEmpty');
    els.decisions = document.getElementById('commandDecisions');
    els.decisionsEmpty = document.getElementById('commandDecisionsEmpty');
    els.alerts = document.getElementById('commandAlerts');
    els.alertsEmpty = document.getElementById('commandAlertsEmpty');
    els.coachingList = document.getElementById('commandCoachingList');
    els.coachingEmpty = document.getElementById('commandCoachingEmpty');
    els.coachingCount = document.getElementById('commandCoachingCount');
    els.absentsList = document.getElementById('commandAbsentsList');
    els.absentsEmpty = document.getElementById('commandAbsentsEmpty');
  }

  function currentWeekKey() {
    return ROSModels.toISODate(ROSModels.startOfWeekMonday());
  }

  function ensureUi(state) {
    if (!state.ui) state.ui = ROSModels.createBlankUiState();
    if (!state.ui.completedActionsByDate || typeof state.ui.completedActionsByDate !== 'object') {
      state.ui.completedActionsByDate = {};
    }
    if (!state.ui.heroPowerWeeklyChecks || typeof state.ui.heroPowerWeeklyChecks !== 'object') {
      state.ui.heroPowerWeeklyChecks = {};
    }
    if (!Array.isArray(state.ui.heroPowerWeeklyHistory)) {
      state.ui.heroPowerWeeklyHistory = [];
    }
    if (!state.ui.coachingContacts || typeof state.ui.coachingContacts !== 'object') {
      state.ui.coachingContacts = {};
    }
    return state.ui;
  }

  function canManageCommand() {
    const role =
      global.ROSProfiles && typeof ROSProfiles.getAppRole === 'function'
        ? ROSProfiles.getAppRole()
        : ROSStorage.getState().appRole;
    return role === 'R4' || role === 'R5';
  }

  function actorStamp() {
    if (global.ROSProfiles && typeof ROSProfiles.stampActor === 'function') {
      return ROSProfiles.stampActor();
    }
    const session =
      global.ROSSync && typeof ROSSync.getSession === 'function' ? ROSSync.getSession() : null;
    const email = session?.user?.email ? String(session.user.email).trim() : '';
    return {
      actorUserId: session?.user?.id || '',
      actorPlayerId: null,
      actorLabel: email || ROSStorage.getState().appRole || 'R4',
    };
  }

  function actorName(record) {
    if (global.ROSProfiles && typeof ROSProfiles.resolveActor === 'function') {
      return ROSProfiles.resolveActor(record);
    }
    return record?.actorLabel || record?.checkedBy || record?.contactedBy || '—';
  }

  function formatDateTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  /** Priorité coaching : 1 = 25–30, 2 = 30–35 ; sinon null. */
  function getCoachingPriority(player, state) {
    if (!player || player.status !== 'Actif') return null;
    const tier = ROSModels.getPlayerPowerTier(player, state);
    if (!tier) return null;
    const min = Number(tier.min);
    const max = Number(tier.max);
    if (min === 25 && max === 30) return 1;
    if (min === 30 && max === 35) return 2;
    return null;
  }

  function getWeeklyCheck(state, weekKey = currentWeekKey()) {
    const ui = state.ui || {};
    const map = ui.heroPowerWeeklyChecks || {};
    const entry = map[weekKey];
    if (!entry || typeof entry !== 'object') {
      return {
        weekKey,
        checked: false,
        checkedBy: '',
        checkedAt: '',
        actorUserId: '',
        actorPlayerId: null,
        actorLabel: '',
        actionId: WEEKLY_ACTION_ID,
      };
    }
    return {
      weekKey,
      checked: Boolean(entry.checked),
      checkedBy: String(entry.checkedBy || ''),
      checkedAt: String(entry.checkedAt || ''),
      actorUserId: String(entry.actorUserId || ''),
      actorPlayerId: entry.actorPlayerId || null,
      actorLabel: String(entry.actorLabel || ''),
      actionId: WEEKLY_ACTION_ID,
    };
  }

  /** Garantit une entrée unique pour la semaine courante (décochée si absente). */
  function ensureCurrentWeeklyEntry(state) {
    const ui = ensureUi(state);
    const weekKey = currentWeekKey();
    if (!ui.heroPowerWeeklyChecks[weekKey]) {
      ui.heroPowerWeeklyChecks[weekKey] = {
        actionId: WEEKLY_ACTION_ID,
        checked: false,
        checkedBy: '',
        checkedAt: '',
      };
    }
    return weekKey;
  }

  function getCoachingRows(state) {
    const contacts = (state.ui && state.ui.coachingContacts) || {};
    const rows = (state.players || [])
      .filter((p) => p.status === 'Actif')
      .map((player) => {
        const priority = getCoachingPriority(player, state);
        if (!priority) return null;
        const tier = ROSModels.getPlayerPowerTier(player, state);
        const stored = contacts[player.id];
        const sameTier = stored && stored.tierId === (tier?.id || '');
        const contacted = Boolean(sameTier && stored.contacted);
        return {
          player,
          priority,
          tier,
          contacted,
          contactedBy: contacted ? String(stored.contactedBy || '') : '',
          contactedAt: contacted ? String(stored.contactedAt || '') : '',
          actorUserId: contacted ? String(stored.actorUserId || '') : '',
          actorPlayerId: contacted ? stored.actorPlayerId || null : null,
          actorLabel: contacted ? String(stored.actorLabel || '') : '',
        };
      })
      .filter(Boolean);

    rows.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return String(a.player.pseudo || '').localeCompare(String(b.player.pseudo || ''), 'fr', {
        sensitivity: 'base',
      });
    });
    return rows;
  }

  /** Réinitialise le contact si la tranche a changé ; purge les joueurs hors coaching. */
  function syncCoachingContacts(state) {
    const ui = ensureUi(state);
    const validIds = new Set();
    (state.players || []).forEach((player) => {
      const priority = getCoachingPriority(player, state);
      if (!priority) return;
      const tier = ROSModels.getPlayerPowerTier(player, state);
      const tierId = tier?.id || '';
      validIds.add(player.id);
      const prev = ui.coachingContacts[player.id];
      if (!prev || typeof prev !== 'object') {
        ui.coachingContacts[player.id] = {
          tierId,
          priority,
          contacted: false,
          contactedBy: '',
          contactedAt: '',
        };
        return;
      }
      if (prev.tierId !== tierId) {
        ui.coachingContacts[player.id] = {
          tierId,
          priority,
          contacted: false,
          contactedBy: '',
          contactedAt: '',
        };
        return;
      }
      prev.priority = priority;
      prev.tierId = tierId;
    });

    Object.keys(ui.coachingContacts).forEach((id) => {
      if (!validIds.has(id)) delete ui.coachingContacts[id];
    });
  }

  function renderKpis(counts) {
    els.kpis.innerHTML = `
      <div class="kpi">
        <span class="kpi-label">Joueurs actifs</span>
        <span class="kpi-value color-steel">${counts.total}</span>
      </div>
      <div class="kpi">
        <span class="kpi-label">Joueurs verts</span>
        <span class="kpi-value color-green">${counts.green}</span>
      </div>
      <div class="kpi">
        <span class="kpi-label">Joueurs orange</span>
        <span class="kpi-value color-orange">${counts.orange}</span>
      </div>
      <div class="kpi">
        <span class="kpi-label">Joueurs rouges</span>
        <span class="kpi-value color-red">${counts.red}</span>
      </div>
    `;
  }

  function renderWeeklyChecklist(state) {
    if (!els.weeklyChecklist) return;
    const weekKey = currentWeekKey();
    const check = getWeeklyCheck(state, weekKey);
    const canManage = canManageCommand();
    const meta = check.checked
      ? `Validé par ${ROSUI.escapeHtml(actorName(check) || '—')} · ${ROSUI.escapeHtml(formatDateTime(check.checkedAt))}`
      : 'À faire cette semaine — décochée jusqu’à validation R4 / R5';

    els.weeklyChecklist.innerHTML = `
      <label class="decision-item level-info">
        <input
          type="checkbox"
          data-weekly-action="${WEEKLY_ACTION_ID}"
          ${check.checked ? 'checked' : ''}
          ${!canManage || check.checked ? 'disabled' : ''}
        />
        <span class="decision-content">
          <strong>${ROSUI.escapeHtml(WEEKLY_ACTION_LABEL)}</strong>
          <small>${meta}</small>
        </span>
      </label>
    `;

    if (els.weeklyHistory) {
      const history = Array.isArray(state.ui?.heroPowerWeeklyHistory)
        ? state.ui.heroPowerWeeklyHistory.slice()
        : [];
      history.sort((a, b) => String(b.weekKey || '').localeCompare(String(a.weekKey || '')));
      const recent = history.filter((h) => h && h.checked).slice(0, 8);
      if (!recent.length) {
        els.weeklyHistory.innerHTML = `<p class="empty-state" style="margin:0">Aucun historique de validation pour le moment.</p>`;
      } else {
        els.weeklyHistory.innerHTML = `
          <p class="panel-subtitle" style="margin-bottom:0.4rem">Historique des validations</p>
          <ul class="command-history-list">
            ${recent
              .map(
                (h) => `
              <li>
                Semaine du ${ROSUI.escapeHtml(h.weekKey || '—')} —
                ${ROSUI.escapeHtml(actorName(h) || '—')} —
                ${ROSUI.escapeHtml(formatDateTime(h.checkedAt))}
              </li>`
              )
              .join('')}
          </ul>
        `;
      }
    }
  }

  function renderContact(contacts) {
    els.contactList.innerHTML = contacts
      .map(({ player, summary }) => {
        const flags = ROSUI.flagsHtml(summary, { emptyLabel: 'Aucun jour pénalisé' });
        return `
          <article class="stack-item" data-open-player="${player.id}">
            <div class="stack-item-top">
              <div>
                <h4 class="stack-item-title">${ROSUI.escapeHtml(player.pseudo)}</h4>
                <div class="player-meta" style="margin-top:0.3rem">
                  <span class="badge badge-role">${ROSUI.escapeHtml(player.role)}</span>
                  <span class="badge">${ROSUI.escapeHtml(summary.colorLabel)}</span>
                </div>
              </div>
              <div class="score-pill ${summary.color}">${summary.total}</div>
            </div>
            <div class="stack-item-meta">${flags}</div>
          </article>
        `;
      })
      .join('');

    els.contactEmpty.classList.toggle('hidden', contacts.length > 0);
  }

  function renderDecisions(decisions) {
    els.decisions.innerHTML = decisions
      .map(
        (decision) => `
        <label class="decision-item level-${decision.level}">
          <input type="checkbox" data-decision-id="${ROSUI.escapeHtml(decision.id)}" />
          <span class="decision-content">
            <strong>${ROSUI.escapeHtml(decision.label)}</strong>
            <small>${ROSUI.escapeHtml(decision.detail || '')}</small>
          </span>
        </label>
      `
      )
      .join('');

    els.decisionsEmpty.classList.toggle('hidden', decisions.length > 0);
  }

  function renderAlerts(alerts) {
    els.alerts.innerHTML = alerts
      .map((alert) => {
        const openAttr = alert.playerId ? `data-open-player="${alert.playerId}"` : '';
        return `
          <article class="stack-item alert-item level-${alert.level}" ${openAttr}>
            <div class="alert-tag">${ROSUI.escapeHtml(alert.tag)}</div>
            <p class="stack-item-title" style="font-weight:600;font-size:0.92rem">${ROSUI.escapeHtml(alert.text)}</p>
          </article>
        `;
      })
      .join('');

    els.alertsEmpty.classList.toggle('hidden', alerts.length > 0);
  }

  function renderCoaching(state) {
    if (!els.coachingList) return;
    const rows = getCoachingRows(state);
    const canManage = canManageCommand();
    const toContact = rows.filter((r) => !r.contacted).length;

    if (els.coachingCount) {
      els.coachingCount.textContent = `Coaching à contacter : ${toContact}`;
    }

    els.coachingList.innerHTML = rows
      .map((row) => {
        const meta = row.contacted
          ? `Contacté par ${ROSUI.escapeHtml(actorName(row) || '—')} · ${ROSUI.escapeHtml(formatDateTime(row.contactedAt))}`
          : 'Pas encore contacté';
        return `
          <article class="stack-item coaching-item priority-${row.priority}">
            <div class="stack-item-top">
              <div>
                <h4 class="stack-item-title">${ROSUI.escapeHtml(row.player.pseudo)}</h4>
                <div class="player-meta" style="margin-top:0.3rem">
                  <span class="badge">${ROSUI.escapeHtml(row.tier?.label || '—')}</span>
                  <span class="badge badge-role">Priorité ${row.priority}</span>
                </div>
              </div>
            </div>
            <label class="decision-item level-${row.priority === 1 ? 'warn' : 'info'}" style="margin-top:0.55rem">
              <input
                type="checkbox"
                data-coaching-player="${ROSUI.escapeHtml(row.player.id)}"
                ${row.contacted ? 'checked' : ''}
                ${canManage ? '' : 'disabled'}
              />
              <span class="decision-content">
                <strong>Prendre contact pour coaching</strong>
                <small>${meta}</small>
              </span>
            </label>
          </article>
        `;
      })
      .join('');

    els.coachingEmpty.classList.toggle('hidden', rows.length > 0);
  }

  function renderAbsents(absents) {
    els.absentsList.innerHTML = absents
      .map(
        (player) => `
        <button type="button" class="absent-chip" data-open-player="${player.id}">
          <span class="badge badge-absent">Absent</span>
          <span>${ROSUI.escapeHtml(player.pseudo)}</span>
        </button>
      `
      )
      .join('');
    els.absentsEmpty.classList.toggle('hidden', absents.length > 0);
  }

  function completeDecision(actionId) {
    const dayKey = ROSUI.todayKey();
    ROSStorage.update((state) => {
      ensureUi(state);
      const list = Array.isArray(state.ui.completedActionsByDate[dayKey])
        ? state.ui.completedActionsByDate[dayKey].slice()
        : [];
      if (!list.includes(actionId)) list.push(actionId);
      state.ui.completedActionsByDate[dayKey] = list;
      return state;
    });
  }

  function completeWeeklyHeroPower() {
    ROSStorage.update((state) => {
      if (!canManageCommand()) return state;
      const ui = ensureUi(state);
      const weekKey = ensureCurrentWeeklyEntry(state);
      const entry = ui.heroPowerWeeklyChecks[weekKey];
      if (entry.checked) return state;

      const checkedAt = new Date().toISOString();
      const actor = actorStamp();
      ui.heroPowerWeeklyChecks[weekKey] = {
        actionId: WEEKLY_ACTION_ID,
        checked: true,
        checkedBy: actor.actorLabel,
        checkedAt,
        actorUserId: actor.actorUserId,
        actorPlayerId: actor.actorPlayerId,
        actorLabel: actor.actorLabel,
      };

      const history = ui.heroPowerWeeklyHistory.filter((h) => h && h.weekKey !== weekKey);
      history.push({
        weekKey,
        actionId: WEEKLY_ACTION_ID,
        label: WEEKLY_ACTION_LABEL,
        checked: true,
        checkedBy: actor.actorLabel,
        checkedAt,
        actorUserId: actor.actorUserId,
        actorPlayerId: actor.actorPlayerId,
        actorLabel: actor.actorLabel,
      });
      history.sort((a, b) => String(a.weekKey || '').localeCompare(String(b.weekKey || '')));
      ui.heroPowerWeeklyHistory = history.slice(-HISTORY_LIMIT);
      return state;
    });
  }

  function setCoachingContact(playerId, contacted) {
    ROSStorage.update((state) => {
      if (!canManageCommand()) return state;
      ensureUi(state);
      syncCoachingContacts(state);
      const player = (state.players || []).find((p) => p.id === playerId);
      if (!player) return state;
      const priority = getCoachingPriority(player, state);
      if (!priority) return state;
      const tier = ROSModels.getPlayerPowerTier(player, state);
      const tierId = tier?.id || '';
      if (contacted) {
        const actor = actorStamp();
        state.ui.coachingContacts[playerId] = {
          tierId,
          priority,
          contacted: true,
          contactedBy: actor.actorLabel,
          contactedAt: new Date().toISOString(),
          actorUserId: actor.actorUserId,
          actorPlayerId: actor.actorPlayerId,
          actorLabel: actor.actorLabel,
        };
      } else {
        state.ui.coachingContacts[playerId] = {
          tierId,
          priority,
          contacted: false,
          contactedBy: '',
          contactedAt: '',
          actorUserId: '',
          actorPlayerId: null,
          actorLabel: '',
        };
      }
      return state;
    });
  }

  function ensureCommandUiSynced() {
    const snapshot = ROSStorage.getState();
    const weekKey = currentWeekKey();
    const ui = snapshot.ui || {};
    const needsWeekEntry = !(ui.heroPowerWeeklyChecks || {})[weekKey];

    // Clone léger pour détecter si la sync coaching modifierait l’état
    const probeState = {
      players: snapshot.players,
      powerTiers: snapshot.powerTiers,
      ui: {
        coachingContacts: JSON.parse(JSON.stringify(ui.coachingContacts || {})),
      },
    };
    const beforeContacts = JSON.stringify(probeState.ui.coachingContacts);
    syncCoachingContacts(probeState);
    const contactsChanged = JSON.stringify(probeState.ui.coachingContacts) !== beforeContacts;

    if (!needsWeekEntry && !contactsChanged) return;

    ROSStorage.update((state) => {
      const stateUi = ensureUi(state);
      if (!stateUi.heroPowerWeeklyChecks[weekKey]) {
        stateUi.heroPowerWeeklyChecks[weekKey] = {
          actionId: WEEKLY_ACTION_ID,
          checked: false,
          checkedBy: '',
          checkedAt: '',
        };
      }
      syncCoachingContacts(state);
      return state;
    });
  }

  function render() {
    ensureCommandUiSynced();

    const state = ROSStorage.getState();
    const week = ROSModels.getCurrentWeekFromState(state);
    if (els.weekLabel) {
      els.weekLabel.textContent = week
        ? `${week.label} · consultation seule · données issues des modules`
        : 'Aucune semaine VS · consultation seule';
    }

    const rows = ROSInsights.getActiveRows(state);
    renderKpis(ROSInsights.getKpiCounts(rows));
    renderWeeklyChecklist(state);
    renderContact(ROSInsights.getContactList(rows));
    renderDecisions(ROSInsights.getPendingDecisions(state, rows));
    renderAlerts(ROSInsights.buildAlerts(state, rows));
    renderCoaching(state);
    renderAbsents(ROSInsights.getAbsentPlayers(state));
  }

  function onRootClick(event) {
    const playerTarget = event.target.closest('[data-open-player]');
    if (
      playerTarget &&
      !event.target.closest('[data-decision-id]') &&
      !event.target.closest('[data-weekly-action]') &&
      !event.target.closest('[data-coaching-player]')
    ) {
      PlayersModule.openDetail(playerTarget.dataset.openPlayer, { allowEdit: false });
    }
  }

  function onDecisionChange(event) {
    const checkbox = event.target.closest('[data-decision-id]');
    if (!checkbox || !checkbox.checked) return;
    completeDecision(checkbox.dataset.decisionId);
  }

  function onWeeklyChange(event) {
    const checkbox = event.target.closest('[data-weekly-action]');
    if (!checkbox) return;
    if (!checkbox.checked) {
      // Une fois cochée, la case reste jusqu’au lundi suivant
      checkbox.checked = true;
      return;
    }
    completeWeeklyHeroPower();
  }

  function onCoachingChange(event) {
    const checkbox = event.target.closest('[data-coaching-player]');
    if (!checkbox) return;
    setCoachingContact(checkbox.dataset.coachingPlayer, checkbox.checked);
  }

  function init() {
    cacheDom();
    const panel = document.getElementById('panel-command');
    panel.addEventListener('click', onRootClick);
    if (els.decisions) els.decisions.addEventListener('change', onDecisionChange);
    if (els.weeklyChecklist) els.weeklyChecklist.addEventListener('change', onWeeklyChange);
    if (els.coachingList) els.coachingList.addEventListener('change', onCoachingChange);
  }

  global.CommandModule = { init, render };
})(window);
