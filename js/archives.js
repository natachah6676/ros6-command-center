/**
 * Module Archives — ROS6 Command Center
 */
(function (global) {
  const els = {};

  function cacheDom() {
    els.search = document.getElementById('archiveSearch');
    els.statusFilter = document.getElementById('archiveStatusFilter');
    els.head = document.getElementById('archiveTableHead');
    els.body = document.getElementById('archiveTableBody');
    els.empty = document.getElementById('archivesEmpty');
    els.table = document.getElementById('archiveTable');
    els.modal = document.getElementById('weekDetailModal');
    els.modalTitle = document.getElementById('weekDetailTitle');
    els.modalBody = document.getElementById('weekDetailBody');
  }

  function filteredPlayers() {
    const search = (els.search.value || '').trim().toLowerCase();
    const status = els.statusFilter.value;

    return ROSStorage.getState().players
      .filter((player) => {
        if (status && player.status !== status) return false;
        if (search && !player.pseudo.toLowerCase().includes(search)) return false;
        return true;
      })
      .sort((a, b) => a.pseudo.localeCompare(b.pseudo, 'fr', { sensitivity: 'base' }));
  }

  function render() {
    const state = ROSStorage.getState();
    const weeks = state.weeks;
    const players = filteredPlayers();

    if (!players.length || !weeks.length) {
      els.head.innerHTML = '';
      els.body.innerHTML = '';
      els.table.classList.add('hidden');
      els.empty.classList.remove('hidden');
      return;
    }

    els.table.classList.remove('hidden');
    els.empty.classList.add('hidden');

    els.head.innerHTML = `
      <tr>
        <th>Joueur</th>
        <th>Rôle</th>
        <th>Statut</th>
        ${weeks
          .map(
            (week) =>
              `<th title="${escapeHtml(week.label)}">${escapeHtml(
                week.label.replace('Semaine du ', '')
              )}</th>`
          )
          .join('')}
      </tr>
    `;

    els.body.innerHTML = players
      .map((player) => {
        const cells = weeks
          .map((week) => {
            const score = week.scores[player.id];
            if (!score) {
              return `
                <td class="week-cell" data-week="${week.id}" data-player="${player.id}" title="Pas de données">
                  <span class="color-cell empty">—</span>
                </td>
              `;
            }
            const total = ROSModels.computeTotal(score);
            const color = ROSModels.getColorClass(total);
            return `
              <td class="week-cell" data-week="${week.id}" data-player="${player.id}" title="${total} pts — ${ROSModels.getColorLabel(total)}">
                <span class="color-cell ${color}">${total}</span>
              </td>
            `;
          })
          .join('');

        return `
          <tr>
            <td>
              <span class="status-dot ${player.status.toLowerCase()}"></span>
              <strong>${escapeHtml(player.pseudo)}</strong>
            </td>
            <td>${escapeHtml(player.role)}</td>
            <td>${escapeHtml(player.status)}</td>
            ${cells}
          </tr>
        `;
      })
      .join('');
  }

  function openWeekDetail(weekId, playerId) {
    const state = ROSStorage.getState();
    const week = state.weeks.find((w) => w.id === weekId);
    const player = state.players.find((p) => p.id === playerId);
    if (!week || !player) return;

    const score = week.scores[playerId] || ROSModels.createEmptyScore();
    const total = ROSModels.computeTotal(score);
    const color = ROSModels.getColorClass(total);

    els.modalTitle.textContent = `${player.pseudo} — ${week.label}`;

    const dayItems = ROSModels.DAYS.map((day) => {
      const points = Number(score.days[day.key]) || 0;
      const label =
        ROSModels.DAY_OPTIONS.find((opt) => opt.value === points)?.label || `${points} pts`;
      return `
        <div class="detail-item">
          <strong>${day.label}</strong>
          <div>${escapeHtml(label)}</div>
        </div>
      `;
    }).join('');

    els.modalBody.innerHTML = `
      <div class="player-meta" style="margin-bottom:0.25rem">
        <span class="badge badge-role">${escapeHtml(player.role)}</span>
        <span class="badge badge-status-${player.status.toLowerCase()}">${escapeHtml(player.status)}</span>
        <span class="score-pill ${color}">${total} pts · ${ROSModels.getColorLabel(total)}</span>
      </div>
      <div class="detail-grid">${dayItems}</div>
      <div class="detail-item">
        <strong>Dons d’alliance</strong>
        <div>${
          score.allianceDonMissed
            ? 'Non réalisés (+5 points)'
            : 'Réalisés (0 point de pénalité)'
        }</div>
      </div>
      <p class="panel-subtitle">
        Période : ${ROSModels.formatDateFR(week.startDate)} → ${ROSModels.formatDateFR(week.endDate)}
      </p>
    `;

    els.modal.showModal();
  }

  function onBodyClick(event) {
    const cell = event.target.closest('.week-cell');
    if (!cell) return;
    openWeekDetail(cell.dataset.week, cell.dataset.player);
  }

  function closeModal() {
    if (els.modal.open) els.modal.close();
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function init() {
    cacheDom();
    els.search.addEventListener('input', render);
    els.statusFilter.addEventListener('change', render);
    els.body.addEventListener('click', onBodyClick);
    els.modal.querySelectorAll('[data-close-modal]').forEach((btn) => {
      btn.addEventListener('click', closeModal);
    });
  }

  global.ArchivesModule = { init, render, openWeekDetail };
})(window);
