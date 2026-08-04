/**
 * Calculs partagés Poste / Alertes / Notifications / Décisions
 */
(function (global) {
  const LEVEL_RANK = { danger: 0, warn: 1, info: 2 };

  function getActiveRows(state) {
    const current = state || ROSStorage.getState();
    const week = ROSModels.getCurrentWeekFromState(current);
    // Absents exclus des calculs VS / contacts / alertes opérationnelles
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

  /** Rouges d'abord, puis orange. */
  function getContactList(rows) {
    const reds = rows
      .filter((r) => r.summary.color === 'color-red')
      .sort((a, b) => b.summary.total - a.summary.total);
    const oranges = rows
      .filter((r) => r.summary.color === 'color-orange')
      .sort((a, b) => b.summary.total - a.summary.total);
    return reds.concat(oranges);
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

  function buildDecisions(state, rows) {
    const current = state || ROSStorage.getState();
    const decisions = [];
    const contacts = getContactList(rows);

    contacts.forEach(({ player, summary }) => {
      decisions.push({
        id: `contact_${player.id}`,
        label: `Contacter ${player.pseudo}`,
        detail: `${summary.total} pts · ${summary.colorLabel}`,
        level: summary.color === 'color-red' ? 'danger' : 'warn',
        playerId: player.id,
      });
    });

    const missedDonations = rows.filter((r) => r.summary.donationMissed);
    if (missedDonations.length) {
      decisions.push({
        id: 'check_dons',
        label: 'Vérifier les dons',
        detail: `${missedDonations.length} joueur(s) avec dons non réalisés`,
        level: 'warn',
        playerId: null,
      });
    }

    if (needsNewWeek(current)) {
      decisions.push({
        id: 'create_week',
        label: 'Créer la prochaine semaine VS',
        detail: 'La semaine calendaire courante n’est pas encore ouverte',
        level: 'info',
        playerId: null,
      });
    }

    if (!rows.length) {
      decisions.push({
        id: 'no_actives',
        label: 'Vérifier la liste des membres',
        detail: 'Aucun joueur actif',
        level: 'info',
        playerId: null,
      });
    }

    return decisions;
  }

  function getCompletedActionIds(state, dayKey) {
    const map = (state.ui && state.ui.completedActionsByDate) || {};
    return new Set(map[dayKey] || []);
  }

  function getPendingDecisions(state, rows) {
    const dayKey = ROSUI.todayKey();
    const done = getCompletedActionIds(state, dayKey);
    return buildDecisions(state, rows).filter((d) => !done.has(d.id));
  }

  function buildNotifications(state, rows) {
    const alerts = buildAlerts(state, rows);
    return alerts.map((alert) => ({
      id: alert.id,
      category: alert.category === 'priority' || alert.level === 'danger' || alert.level === 'warn'
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
    getContactList,
    buildAlerts,
    buildDecisions,
    getPendingDecisions,
    buildNotifications,
    needsNewWeek,
  };
})(window);
