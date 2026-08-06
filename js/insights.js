/**
 * Calculs partagés Poste / Alertes / Notifications
 */
(function (global) {
  const LEVEL_RANK = { danger: 0, warn: 1, info: 2 };

  function getActiveRows(state) {
    const current = state || ROSStorage.getState();
    const week = ROSModels.getCurrentWeekFromState(current);
    // Absents exclus des calculs VS / alertes opérationnelles
    return current.players
      .filter((p) => ROSModels.isVsParticipant(p))
      .map((player) => ({
        player,
        week,
        summary: ROSModels.getWeekScoreSummary(week, player.id),
      }))
      .sort((a, b) => a.player.pseudo.localeCompare(b.player.pseudo, 'fr', { sensitivity: 'base' }));
  }

  function getAbsentPlayers(state) {
    const current = state || ROSStorage.getState();
    return current.players
      .filter((p) => p.status === 'Actif' && p.absent)
      .sort((a, b) => a.pseudo.localeCompare(b.pseudo, 'fr', { sensitivity: 'base' }));
  }

  function getKpiCounts(rows) {
    return {
      total: rows.length,
      green: rows.filter((r) => r.summary.color === 'color-green').length,
      orange: rows.filter((r) => r.summary.color === 'color-orange').length,
      red: rows.filter((r) => r.summary.color === 'color-red').length,
    };
  }

  function sortByImportance(items) {
    return items.slice().sort((a, b) => {
      const lr = (LEVEL_RANK[a.level] ?? 9) - (LEVEL_RANK[b.level] ?? 9);
      if (lr !== 0) return lr;
      return String(a.text || '').localeCompare(String(b.text || ''), 'fr', { sensitivity: 'base' });
    });
  }

  function buildAlerts(state, rows) {
    const alerts = [];
    const current = state || ROSStorage.getState();
    const week = ROSModels.getCurrentWeekFromState(current);

    if (!week || !(current.weeks || []).length) {
      alerts.push({
        id: 'no_week',
        level: 'danger',
        category: 'priority',
        tag: 'Semaine VS',
        text: 'Aucune semaine VS n’existe. Créez une semaine dans le module VS.',
        playerId: null,
      });
    }

    rows.forEach(({ player, summary }) => {
      const redStreak = ROSModels.countConsecutiveRed(current, player.id);
      if (redStreak >= 3) {
        alerts.push({
          id: `red3_${player.id}`,
          level: 'danger',
          category: 'priority',
          tag: 'Rouge ×3+',
          text: `${player.pseudo} est rouge depuis ${redStreak} semaines consécutives.`,
          playerId: player.id,
        });
      } else if (redStreak === 2) {
        alerts.push({
          id: `red2_${player.id}`,
          level: 'warn',
          category: 'priority',
          tag: 'Rouge ×2',
          text: `${player.pseudo} est rouge depuis 2 semaines consécutives.`,
          playerId: player.id,
        });
      }

      const donStreak = ROSModels.countConsecutiveMissedDonations(current, player.id);
      if (donStreak >= 2) {
        alerts.push({
          id: `don2_${player.id}`,
          level: 'warn',
          category: 'priority',
          tag: 'Dons ×2',
          text: `${player.pseudo} : dons non réalisés sur ${donStreak} semaines consécutives.`,
          playerId: player.id,
        });
      }

      if (!summary.hasRecord) {
        alerts.push({
          id: `nodata_${player.id}`,
          level: 'warn',
          category: 'priority',
          tag: 'Sans VS',
          text: `${player.pseudo} est actif mais n’a aucune donnée VS cette semaine.`,
          playerId: player.id,
        });
      }
    });

    return sortByImportance(alerts);
  }

  function needsNewWeek(state) {
    const week = ROSModels.getCurrentWeekFromState(state);
    if (!week) return true;
    const calendarMonday = ROSModels.toISODate(ROSModels.startOfWeekMonday());
    return week.startDate < calendarMonday;
  }

  function buildNotifications(state, rows) {
    const alerts = buildAlerts(state, rows);
    return alerts.map((alert) => ({
      id: alert.id,
      category:
        alert.category === 'priority' || alert.level === 'danger' || alert.level === 'warn'
          ? 'priority'
          : 'info',
      level: alert.level,
      tag: alert.tag,
      text: alert.text,
      playerId: alert.playerId,
    }));
  }

  global.ROSInsights = {
    getActiveRows,
    getAbsentPlayers,
    getKpiCounts,
    buildAlerts,
    buildNotifications,
    needsNewWeek,
  };
})(window);
