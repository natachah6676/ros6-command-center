/**
 * Utilitaires UI réutilisables — ROS6 Command Center
 */
(function (global) {
  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function flagsHtml(summary, options = {}) {
    const parts = [];
    const emptyLabel = options.emptyLabel || null;

    (summary.flaggedDays || []).forEach((day) => {
      parts.push(
        `<span class="chip ${day.points === 10 ? 'danger' : 'warn'}">${escapeHtml(day.short)} · ${day.points} pts</span>`
      );
    });

    if (summary.donationMissed) {
      parts.push('<span class="chip warn">Dons non réalisés</span>');
    }

    if (!parts.length && emptyLabel) {
      parts.push(`<span class="chip muted">${escapeHtml(emptyLabel)}</span>`);
    }

    return parts.join('');
  }

  function todayKey(date = new Date()) {
    return ROSModels.toISODate(date);
  }

  function getPlayerWeekNote(state, playerId, weekId) {
    const notes = state.playerWeekNotes || {};
    const playerNotes = notes[playerId] || {};
    const note = playerNotes[weekId] || {};
    return {
      comment: note.comment || '',
      conducteur: note.conducteur || '',
      vip: note.vip || '',
      saison: note.saison || '',
    };
  }

  global.ROSUI = {
    escapeHtml,
    flagsHtml,
    todayKey,
    getPlayerWeekNote,
  };
})(window);
