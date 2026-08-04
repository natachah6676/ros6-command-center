/**
 * Poste de Commandement — consultation seule
 */
(function (global) {
  const els = {};

  function cacheDom() {
    els.weekLabel = document.getElementById('commandWeekLabel');
    els.kpis = document.getElementById('commandKpis');
    els.contactList = document.getElementById('commandContactList');
    els.contactEmpty = document.getElementById('commandContactEmpty');
    els.decisions = document.getElementById('commandDecisions');
    els.decisionsEmpty = document.getElementById('commandDecisionsEmpty');
    els.alerts = document.getElementById('commandAlerts');
    els.alertsEmpty = document.getElementById('commandAlertsEmpty');
    els.absentsList = document.getElementById('commandAbsentsList');
    els.absentsEmpty = document.getElementById('commandAbsentsEmpty');
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
      if (!state.ui) state.ui = ROSModels.createBlankUiState();
      if (!state.ui.completedActionsByDate) state.ui.completedActionsByDate = {};
      const list = Array.isArray(state.ui.completedActionsByDate[dayKey])
        ? state.ui.completedActionsByDate[dayKey].slice()
        : [];
      if (!list.includes(actionId)) list.push(actionId);
      state.ui.completedActionsByDate[dayKey] = list;
      return state;
    });
  }

  function render() {
    const state = ROSStorage.getState();
    const week = ROSModels.getCurrentWeekFromState(state);
    if (els.weekLabel) {
      els.weekLabel.textContent = week
        ? `${week.label} · consultation seule · données issues des modules`
        : 'Aucune semaine VS · consultation seule';
    }

    const rows = ROSInsights.getActiveRows(state);
    renderKpis(ROSInsights.getKpiCounts(rows));
    renderContact(ROSInsights.getContactList(rows));
    renderDecisions(ROSInsights.getPendingDecisions(state, rows));
    renderAlerts(ROSInsights.buildAlerts(state, rows));
    renderAbsents(ROSInsights.getAbsentPlayers(state));
  }

  function onRootClick(event) {
    const playerTarget = event.target.closest('[data-open-player]');
    if (playerTarget && !event.target.closest('[data-decision-id]')) {
      PlayersModule.openDetail(playerTarget.dataset.openPlayer, { allowEdit: false });
    }
  }

  function onDecisionChange(event) {
    const checkbox = event.target.closest('[data-decision-id]');
    if (!checkbox || !checkbox.checked) return;
    completeDecision(checkbox.dataset.decisionId);
  }

  function init() {
    cacheDom();
    const panel = document.getElementById('panel-command');
    panel.addEventListener('click', onRootClick);
    els.decisions.addEventListener('change', onDecisionChange);
  }

  global.CommandModule = { init, render };
})(window);
