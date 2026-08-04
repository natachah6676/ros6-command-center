/**
 * Statistiques globales joueur — recalculées depuis les archives (aucun compteur dupliqué).
 */
(function (global) {
  function readStore(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (error) {
      console.error('Stats: lecture impossible', key, error);
      return null;
    }
  }

  function trainStorageKey() {
    return (global.TrainModule && TrainModule.STORAGE_KEY) || 'ros6_train_v1';
  }

  function tempeteStorageKey() {
    return (global.TempeteModule && TempeteModule.STORAGE_KEY) || 'ros6_tempete_v1';
  }

  function computePlayerStats(playerId) {
    const empty = {
      conductor: 0,
      vip: 0,
      vsRed: 0,
      storms: 0,
      absencesUnexcused: 0,
      absencesExcused: 0,
    };
    if (!playerId) return empty;

    const train = readStore(trainStorageKey()) || {};
    const closedWeekIds = new Set(
      Object.entries(train.appliedPlans || {})
        .filter(([, plan]) => plan && (plan.locked || plan.closedAt || plan.validatedAt))
        .map(([weekId]) => weekId)
    );

    const conductorWeeks = new Set();
    const vipWeeks = new Set();
    (Array.isArray(train.history) ? train.history : []).forEach((entry) => {
      if (!entry || !entry.weekId) return;
      // Historique Train = semaines clôturées ; filtre appliedPlans si présent
      if (closedWeekIds.size && !closedWeekIds.has(entry.weekId)) return;
      if (entry.conductorId === playerId) conductorWeeks.add(entry.weekId);
      if (entry.vipId === playerId) vipWeeks.add(entry.weekId);
    });

    const alliance = global.ROSStorage ? ROSStorage.getState() : null;
    let vsRed = 0;
    if (alliance && Array.isArray(alliance.weeks)) {
      const seen = new Set();
      alliance.weeks.forEach((week) => {
        if (!week || !week.archived || seen.has(week.id)) return;
        if (!week.scores || !week.scores[playerId]) return;
        const summary = ROSModels.getWeekScoreSummary(week, playerId);
        if (summary.hasRecord && summary.color === 'color-red') {
          seen.add(week.id);
          vsRed += 1;
        }
      });
    }

    const tempete = readStore(tempeteStorageKey()) || {};
    const stormIds = new Set();
    let absencesUnexcused = 0;
    let absencesExcused = 0;
    (Array.isArray(tempete.archives) ? tempete.archives : []).forEach((arch) => {
      if (!arch || !arch.id) return;
      const inParticipants = (arch.participants || []).some((p) => (p.id || p) === playerId);
      const inRemplacants = (arch.remplacants || []).some((p) => (p.id || p) === playerId);
      if (!inParticipants && !inRemplacants) return;
      if (stormIds.has(arch.id)) return;
      stormIds.add(arch.id);

      const status = arch.attendance ? arch.attendance[playerId] : null;
      if (status === 'absent') absencesUnexcused += 1;
      else if (status === 'absent_excuse') absencesExcused += 1;
    });

    return {
      conductor: conductorWeeks.size,
      vip: vipWeeks.size,
      vsRed,
      storms: stormIds.size,
      absencesUnexcused,
      absencesExcused,
    };
  }

  function renderStatsHtml(playerId) {
    const stats = computePlayerStats(playerId);
    return `
      <div class="player-stats-block">
        <strong class="section-label">Statistiques globales</strong>
        <p class="panel-subtitle" style="margin:0.35rem 0 0.65rem">
          Recalculées automatiquement depuis les archives
        </p>
        <ul class="player-stats-list">
          <li><span>Conducteur</span><strong>${stats.conductor} fois</strong></li>
          <li><span>VIP</span><strong>${stats.vip} fois</strong></li>
          <li><span>VS rouges</span><strong>${stats.vsRed} semaines</strong></li>
          <li><span>Tempêtes</span><strong>${stats.storms} participations</strong></li>
          <li><span>Absences non excusées</span><strong>${stats.absencesUnexcused}</strong></li>
          <li><span>Absences excusées</span><strong>${stats.absencesExcused}</strong></li>
        </ul>
      </div>
    `;
  }

  global.PlayerStats = {
    computePlayerStats,
    renderStatsHtml,
  };
})(window);
