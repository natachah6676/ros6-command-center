/**
 * Persistance localStorage — ROS6 Command Center
 */
(function (global) {
  const STORAGE_KEY = 'ros6_command_center_v1';

  let state = null;
  const listeners = new Set();

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      // Premier lancement uniquement : aucune clé en localStorage → liste initiale.
      // Si des données existent déjà, elles ne sont jamais écrasées ici.
      if (!raw) {
        state = ROSModels.createInitialState();
        persist(false);
        return state;
      }
      state = ROSModels.normalizeState(JSON.parse(raw));
      return state;
    } catch (error) {
      console.error('Erreur de chargement localStorage', error);
      // Données corrompues uniquement : repartir d'un état initial (avec roster seed)
      state = ROSModels.createInitialState();
      return state;
    }
  }

  function persist(notify = true) {
    if (!state) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if (global.ROSSync && typeof ROSSync.schedulePush === 'function') {
      ROSSync.schedulePush();
    }
    if (notify) {
      listeners.forEach((fn) => {
        try {
          fn(state);
        } catch (err) {
          console.error(err);
        }
      });
    }
  }

  function getState() {
    if (!state) load();
    return state;
  }

  function update(mutator, options = {}) {
    const current = getState();
    const next = mutator(current) || current;
    state = ROSModels.normalizeState(next);
    persist(!options.silent);
    return state;
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function exportJSON() {
    const data = getState();
    return JSON.stringify(
      {
        ...data,
        exportedAt: new Date().toISOString(),
        appName: 'ROS6 Command Center',
      },
      null,
      2
    );
  }

  function importJSON(jsonText) {
    const parsed = JSON.parse(jsonText);
    state = ROSModels.normalizeState(parsed);
    persist(true);
    return state;
  }

  function resetAll() {
    state = ROSModels.createInitialState();
    persist(true);
    return state;
  }

  function getCurrentWeek() {
    const s = getState();
    return s.weeks.find((w) => w.id === s.currentWeekId) || s.weeks[0];
  }

  function getActivePlayers() {
    return getState().players.filter((p) => p.status === 'Actif');
  }

  function getVsPlayers() {
    return getState().players.filter((p) => ROSModels.isVsParticipant(p));
  }

  function getTrainEligiblePlayers() {
    return getState().players.filter((p) => ROSModels.isEligibleForTrain(p));
  }

  function getPlayerById(id) {
    return getState().players.find((p) => p.id === id) || null;
  }

  global.ROSStorage = {
    STORAGE_KEY,
    load,
    getState,
    update,
    subscribe,
    exportJSON,
    importJSON,
    resetAll,
    getCurrentWeek,
    getActivePlayers,
    getVsPlayers,
    getTrainEligiblePlayers,
    getPlayerById,
  };
})(window);
