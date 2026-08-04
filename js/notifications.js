/**
 * Système de notifications — générées automatiquement
 */
(function (global) {
  const els = {};
  let filter = 'priority';

  function cacheDom() {
    els.btn = document.getElementById('btnNotifications');
    els.badge = document.getElementById('notifBadge');
    els.overlay = document.getElementById('notifOverlay');
    els.drawer = document.getElementById('notifDrawer');
    els.body = document.getElementById('notifBody');
    els.close = document.getElementById('notifClose');
    els.tabs = els.drawer.querySelector('.notif-tabs');
  }

  function getNotifications() {
    const state = ROSStorage.getState();
    const rows = ROSInsights.getActiveRows(state);
    return ROSInsights.buildNotifications(state, rows);
  }

  function updateBadge() {
    const count = getNotifications().length;
    els.badge.textContent = String(count);
    els.badge.classList.toggle('hidden', count === 0);
  }

  function renderList() {
    const all = getNotifications();
    const filtered =
      filter === 'all' ? all : all.filter((n) => n.category === filter);

    if (!filtered.length) {
      els.body.innerHTML = '<p class="empty-state">Aucune notification dans cette catégorie.</p>';
      return;
    }

    els.body.innerHTML = filtered
      .map(
        (n) => `
        <article class="stack-item alert-item level-${n.level}" ${
          n.playerId ? `data-open-player="${n.playerId}"` : ''
        }>
          <div class="alert-tag">${ROSUI.escapeHtml(n.tag)} · ${
            n.category === 'priority' ? 'Priorité' : 'Information'
          }</div>
          <p class="stack-item-title" style="font-weight:600;font-size:0.92rem">${ROSUI.escapeHtml(n.text)}</p>
        </article>
      `
      )
      .join('');
  }

  function open() {
    renderList();
    els.overlay.hidden = false;
    els.drawer.classList.add('is-open');
    els.drawer.setAttribute('aria-hidden', 'false');
  }

  function close() {
    els.drawer.classList.remove('is-open');
    els.drawer.setAttribute('aria-hidden', 'true');
    els.overlay.hidden = true;
  }

  function render() {
    updateBadge();
    if (els.drawer.classList.contains('is-open')) {
      renderList();
    }
  }

  function init() {
    cacheDom();
    els.btn.addEventListener('click', open);
    els.close.addEventListener('click', close);
    els.overlay.addEventListener('click', close);

    els.tabs.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-notif-filter]');
      if (!btn) return;
      filter = btn.dataset.notifFilter;
      els.tabs.querySelectorAll('.chip-filter').forEach((el) => {
        el.classList.toggle('is-active', el === btn);
      });
      renderList();
    });

    els.body.addEventListener('click', (event) => {
      const target = event.target.closest('[data-open-player]');
      if (!target) return;
      close();
      PlayersModule.openDetail(target.dataset.openPlayer, { allowEdit: false });
    });
  }

  global.NotificationsModule = { init, render, open, close };
})(window);
