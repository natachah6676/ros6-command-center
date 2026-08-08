/**
 * Module Ruche — indépendant (stockage dédié)
 *
 * Structure :
 * - grille 10×10 = 100 cases (dont 1 Maréchal au centre)
 * - case du bas au milieu = 101ᵉ case, attribuable à un joueur (ou FREE)
 * - total = 101 cases
 * - 100 cases attribuables joueurs/FREE = grille hors Maréchal + case du bas
 * - Maréchal = 1 case au milieu, jamais FREE
 */
(function (global) {
  const STORAGE_KEY = 'ros6_ruche_v1';
  const GRID_SIZE = 10;
  const GRID_SLOTS = GRID_SIZE * GRID_SIZE; // 100
  const TOTAL_CASES = GRID_SLOTS + 1; // 101
  const PLAYER_SLOTS = TOTAL_CASES - 1; // 100 (hors Maréchal)
  const FREE = 'FREE';
  /** Case Maréchal unique au centre de la grille (0-index) */
  const MARSHAL_ROW = 4;
  const MARSHAL_COL = 4;

  /** Couleurs de rôle uniquement (Maréchal / R5·R4 / FREE). */
  const DEFAULT_COLORS = {
    marshal: '#7b3fa0', // violet
    r4: '#5B9BD5', // bleu — partagé R5 et R4
    member: '#6b7280', // conservé en stockage, non utilisé pour le rendu décoratif
    free: '#000000',
  };

  /**
   * Pastels par cadre concentrique (anneau 0 = extérieur → centre).
   * Indépendants du rôle / niveau / puissance.
   */
  const RING_PASTELS = [
    '#A8D4F0', // bleu clair — cadre extérieur
    '#B8E6C8', // vert clair
    '#F5E8A8', // jaune pâle
    '#F5C6D4', // rose pâle
    '#D4C4E8', // lavande — centre
  ];

  const els = {};
  let state = null;
  let lastCheck = null;
  let skipPersist = false;

  function uid(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function isMarshalCell(row, col) {
    return row === MARSHAL_ROW && col === MARSHAL_COL;
  }

  function createEmptyGrid() {
    return Array.from({ length: GRID_SIZE }, () =>
      Array.from({ length: GRID_SIZE }, () => null)
    );
  }

  function normalizeCellValue(value, { allowFree = true } = {}) {
    if (value === FREE || value === 'FREE') return allowFree ? FREE : null;
    if (typeof value === 'string' && value) return value;
    return null;
  }

  function normalizeGrid(raw) {
    const grid = createEmptyGrid();
    if (!Array.isArray(raw)) return grid;
    for (let r = 0; r < GRID_SIZE; r += 1) {
      const row = Array.isArray(raw[r]) ? raw[r] : [];
      for (let c = 0; c < GRID_SIZE; c += 1) {
        grid[r][c] = normalizeCellValue(row[c], { allowFree: !isMarshalCell(r, c) });
      }
    }
    return grid;
  }

  function cloneGrid(grid) {
    return grid.map((row) => row.slice());
  }

  function createBlankState() {
    return {
      version: 5,
      grid: createEmptyGrid(),
      bottomId: null,
      colors: { ...DEFAULT_COLORS },
      archives: [],
      proposal: null,
    };
  }

  function normalizeProposal(raw) {
    if (!raw || typeof raw !== 'object') return null;
    return {
      grid: normalizeGrid(raw.grid),
      bottomId: normalizeCellValue(raw.bottomId, { allowFree: true }),
      generatedAt: String(raw.generatedAt || ''),
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        state = createBlankState();
        persist();
        return state;
      }
      const parsed = JSON.parse(raw);
      let grid = normalizeGrid(parsed.grid);
      // Migration ancien marshalId hors grille → case centre
      if (
        parsed.marshalId &&
        parsed.marshalId !== FREE &&
        (!grid[MARSHAL_ROW][MARSHAL_COL] || grid[MARSHAL_ROW][MARSHAL_COL] === FREE)
      ) {
        grid = cloneGrid(grid);
        for (let r = 0; r < GRID_SIZE; r += 1) {
          for (let c = 0; c < GRID_SIZE; c += 1) {
            if (grid[r][c] === parsed.marshalId) grid[r][c] = null;
          }
        }
        grid[MARSHAL_ROW][MARSHAL_COL] = parsed.marshalId;
      }
      const colors = {
        ...DEFAULT_COLORS,
        ...(parsed.colors && typeof parsed.colors === 'object' ? parsed.colors : {}),
      };
      // Ancienne couleur R4 rouge → bleu R5/R4
      if (String(colors.r4).toLowerCase() === '#c43b4e') {
        colors.r4 = DEFAULT_COLORS.r4;
      }
      state = {
        version: 5,
        grid,
        bottomId: normalizeCellValue(parsed.bottomId, { allowFree: true }),
        colors,
        archives: Array.isArray(parsed.archives) ? parsed.archives : [],
        proposal: normalizeProposal(parsed.proposal),
      };
      if (global.ROSPlayerIdentity && global.ROSStorage) {
        ROSPlayerIdentity.migrateRucheState(state, ROSStorage.getState().players);
      }
      persist();
      return state;
    } catch (error) {
      console.error('Ruche: chargement impossible', error);
      state = createBlankState();
      return state;
    }
  }

  function persist() {
    if (skipPersist) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if (global.ROSSync && typeof ROSSync.schedulePush === 'function') {
      ROSSync.schedulePush();
    }
  }

  /** Recharge depuis localStorage sans renvoyer vers Supabase. */
  function hydrateFromStorage() {
    skipPersist = true;
    try {
      loadState();
    } finally {
      skipPersist = false;
    }
    return state;
  }

  function getState() {
    if (!state) loadState();
    return state;
  }

  function update(mutator) {
    const current = getState();
    state = mutator(current) || current;
    persist();
    lastCheck = null;
    render();
  }

  function getAlliancePlayers() {
    return ROSStorage.getState().players || [];
  }

  function getActivePlayers() {
    return getAlliancePlayers()
      .filter((p) => p.status === 'Actif')
      .sort((a, b) => a.pseudo.localeCompare(b.pseudo, 'fr', { sensitivity: 'base' }));
  }

  function getPlayerById(id) {
    if (!id || id === FREE) return null;
    return getAlliancePlayers().find((p) => p.id === id) || null;
  }

  function getCell(row, col) {
    const grid = getState().grid;
    if (row < 0 || col < 0 || row >= GRID_SIZE || col >= GRID_SIZE) return null;
    return grid[row][col];
  }

  /**
   * Maréchal = valeur de la case à position fixe (MARSHAL_ROW, MARSHAL_COL).
   * Ne dépend pas du libellé affiché ; FREE / vide = non renseigné.
   */
  function getMarshalId(grid = getState().grid) {
    if (!grid || !Array.isArray(grid)) return null;
    const row = grid[MARSHAL_ROW];
    if (!Array.isArray(row)) return null;
    const value = normalizeCellValue(row[MARSHAL_COL], { allowFree: false });
    return value || null;
  }

  /** Fallback : lit le sélecteur de la case centrale (même position fixe). */
  function readMarshalIdFromDom() {
    const select =
      els.grid?.querySelector(
        `select[data-ruche-select][data-row="${MARSHAL_ROW}"][data-col="${MARSHAL_COL}"]`
      ) || els.grid?.querySelector('select.ruche-marshal-select');
    if (!select) return null;
    return normalizeCellValue(select.value, { allowFree: false });
  }

  /**
   * Garantit que la case centrale en état reflète le sélecteur Maréchal.
   * Utile si l’UI affiche une sélection non encore persistée.
   */
  function syncMarshalFromDomIfNeeded() {
    const fromState = getMarshalId();
    if (fromState) return fromState;
    const fromDom = readMarshalIdFromDom();
    if (!fromDom) return null;
    const s = getState();
    s.grid = cloneGrid(s.grid);
    s.grid[MARSHAL_ROW][MARSHAL_COL] = fromDom;
    persist();
    return fromDom;
  }

  function getBottomId(trainState = getState()) {
    return normalizeCellValue(trainState.bottomId, { allowFree: true });
  }

  function removePlayerFromAll(s, playerId, keep) {
    if (!playerId || playerId === FREE) return;
    s.grid = cloneGrid(s.grid);
    for (let r = 0; r < GRID_SIZE; r += 1) {
      for (let c = 0; c < GRID_SIZE; c += 1) {
        if (keep && keep.type === 'grid' && keep.row === r && keep.col === c) continue;
        if (s.grid[r][c] === playerId) s.grid[r][c] = null;
      }
    }
    if (!(keep && keep.type === 'bottom') && s.bottomId === playerId) {
      s.bottomId = null;
    }
  }

  function setCell(row, col, value) {
    if (row < 0 || col < 0 || row >= GRID_SIZE || col >= GRID_SIZE) return false;
    update((s) => {
      let next = normalizeCellValue(value, { allowFree: !isMarshalCell(row, col) });
      if (isMarshalCell(row, col) && next === FREE) next = null;
      if (next && next !== FREE) removePlayerFromAll(s, next, { type: 'grid', row, col });
      else s.grid = cloneGrid(s.grid);
      s.grid[row][col] = next;
      return s;
    });
    return true;
  }

  function setMarshal(playerId) {
    return setCell(MARSHAL_ROW, MARSHAL_COL, playerId && playerId !== FREE ? playerId : null);
  }

  function setBottom(value) {
    update((s) => {
      const next = normalizeCellValue(value, { allowFree: true });
      if (next && next !== FREE) removePlayerFromAll(s, next, { type: 'bottom' });
      s.bottomId = next;
      return s;
    });
    return true;
  }

  function clearCell(row, col) {
    return setCell(row, col, null);
  }

  function swapCells(rowA, colA, rowB, colB) {
    if (
      rowA < 0 ||
      colA < 0 ||
      rowB < 0 ||
      colB < 0 ||
      rowA >= GRID_SIZE ||
      colA >= GRID_SIZE ||
      rowB >= GRID_SIZE ||
      colB >= GRID_SIZE
    ) {
      return false;
    }
    update((s) => {
      s.grid = cloneGrid(s.grid);
      let a = s.grid[rowA][colA];
      let b = s.grid[rowB][colB];
      if (isMarshalCell(rowA, colA) && b === FREE) b = null;
      if (isMarshalCell(rowB, colB) && a === FREE) a = null;
      s.grid[rowA][colA] = b;
      s.grid[rowB][colB] = a;
      return s;
    });
    return true;
  }

  /**
   * except: { type:'grid', row, col } | { type:'bottom' }
   */
  function getUsedPlayerIdsExcept(except) {
    const used = new Set();
    const s = getState();
    for (let r = 0; r < GRID_SIZE; r += 1) {
      for (let c = 0; c < GRID_SIZE; c += 1) {
        if (except?.type === 'grid' && except.row === r && except.col === c) continue;
        const value = s.grid[r][c];
        if (value && value !== FREE) used.add(value);
      }
    }
    if (!(except?.type === 'bottom')) {
      const bottom = getBottomId(s);
      if (bottom && bottom !== FREE) used.add(bottom);
    }
    return used;
  }

  function getColors() {
    return { ...DEFAULT_COLORS, ...getState().colors };
  }

  /** Indice du cadre concentrique (0 = pourtour extérieur). */
  function ringIndex(row, col) {
    return Math.min(row, col, GRID_SIZE - 1 - row, GRID_SIZE - 1 - col);
  }

  function ringPastel(row, col) {
    const idx = Math.min(ringIndex(row, col), RING_PASTELS.length - 1);
    return RING_PASTELS[idx];
  }

  function isOfficerRole(role) {
    return role === 'R5' || role === 'R4';
  }

  function isOfficerPlayer(player) {
    return Boolean(player && isOfficerRole(player.role));
  }

  function slotKey(slot) {
    if (!slot) return '';
    if (slot.type === 'bottom') return 'bottom';
    return `grid:${slot.row}:${slot.col}`;
  }

  function sameSlot(a, b) {
    return slotKey(a) === slotKey(b);
  }

  /** Distance Chebyshev au Maréchal (case du bas = anneau extérieur). */
  function chebyshevDist(slot) {
    if (!slot || slot.type === 'bottom') return GRID_SIZE;
    return Math.max(
      Math.abs(Number(slot.row) - MARSHAL_ROW),
      Math.abs(Number(slot.col) - MARSHAL_COL)
    );
  }

  function getProposal() {
    const s = getState();
    if (!s.proposal) return null;
    return {
      grid: cloneGrid(s.proposal.grid),
      bottomId: s.proposal.bottomId,
      generatedAt: s.proposal.generatedAt || '',
    };
  }

  function collectPlayerPositions(grid, bottomId) {
    const map = new Map();
    for (let r = 0; r < GRID_SIZE; r += 1) {
      for (let c = 0; c < GRID_SIZE; c += 1) {
        const value = normalizeCellValue(grid?.[r]?.[c], { allowFree: !isMarshalCell(r, c) });
        if (value && value !== FREE) map.set(value, { type: 'grid', row: r, col: c });
      }
    }
    const bottom = normalizeCellValue(bottomId, { allowFree: true });
    if (bottom && bottom !== FREE) map.set(bottom, { type: 'bottom' });
    return map;
  }

  function getCellValueFromHive(hive, slot) {
    if (!hive || !slot) return null;
    if (slot.type === 'bottom') return normalizeCellValue(hive.bottomId, { allowFree: true });
    return normalizeCellValue(hive.grid?.[slot.row]?.[slot.col], {
      allowFree: !isMarshalCell(slot.row, slot.col),
    });
  }

  function setHiveSlot(hive, slot, value) {
    const next = normalizeCellValue(value, {
      allowFree: !(slot.type === 'grid' && isMarshalCell(slot.row, slot.col)),
    });
    if (slot.type === 'bottom') {
      hive.bottomId = next;
      return;
    }
    if (isMarshalCell(slot.row, slot.col) && next === FREE) {
      hive.grid[slot.row][slot.col] = null;
      return;
    }
    hive.grid[slot.row][slot.col] = next;
  }

  function isLockedSlotOnHive(hive, slot, options = {}) {
    if (!slot) return true;
    if (slot.type === 'grid' && isMarshalCell(slot.row, slot.col)) return true;
    const value = getCellValueFromHive(hive, slot);
    const player = getPlayerById(value);
    // R4/R5 : toujours verrouillés sauf autorisation explicite (plan complet + case cochée)
    if (isOfficerPlayer(player)) return options.allowOfficerMoves !== true;
    return false;
  }

  function buildRuchePowerScoreMap(mainState) {
    const players = (mainState?.players || []).filter((p) => p && p.status === 'Actif');
    return ROSModels.buildCompositePowerScoreMap(players, mainState);
  }

  /** Score puissance 70/30 ; null = données incomplètes (neutre dans les comparaisons). */
  function playerPowerValue(playerId, mainState, scoreMap) {
    const map = scoreMap || buildRuchePowerScoreMap(mainState);
    const score = ROSModels.getPlayerCompositePowerScore(getPlayerById(playerId), map);
    return score == null ? null : score;
  }

  /**
   * Qualité d’une disposition : paires concordantes (plus fort plus près du Maréchal).
   * Max = n(n-1)/2 pour n joueurs déplaçables.
   */
  function placementQuality(posMap, movableIds, mainState, scoreMap) {
    const ids = movableIds.filter((id) => posMap.has(id));
    let score = 0;
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const a = ids[i];
        const b = ids[j];
        const pa = playerPowerValue(a, mainState, scoreMap);
        const pb = playerPowerValue(b, mainState, scoreMap);
        // Données incomplètes : neutre (ni avantage ni pénalité)
        if (pa == null || pb == null || pa === pb) {
          score += 1;
          continue;
        }
        const stronger = pa > pb ? a : b;
        const weaker = pa > pb ? b : a;
        if (chebyshevDist(posMap.get(stronger)) <= chebyshevDist(posMap.get(weaker))) {
          score += 1;
        }
      }
    }
    return score;
  }

  function pairConcordant(idA, idB, distA, distB, mainState, scoreMap) {
    const pa = playerPowerValue(idA, mainState, scoreMap);
    const pb = playerPowerValue(idB, mainState, scoreMap);
    if (pa == null || pb == null || pa === pb) return true;
    if (pa > pb) return distA <= distB;
    return distB <= distA;
  }

  /** Δ qualité après échange des positions de idA et idB (O(n)). */
  function qualityDeltaForSwap(posMap, movableIds, idA, idB, mainState, scoreMap) {
    if (!idA || !idB || idA === idB) return 0;
    const slotA = posMap.get(idA);
    const slotB = posMap.get(idB);
    if (!slotA || !slotB) return 0;
    const distA = chebyshevDist(slotA);
    const distB = chebyshevDist(slotB);
    let delta = 0;
    if (pairConcordant(idA, idB, distA, distB, mainState, scoreMap)) delta -= 1;
    if (pairConcordant(idA, idB, distB, distA, mainState, scoreMap)) delta += 1;
    for (let i = 0; i < movableIds.length; i += 1) {
      const other = movableIds[i];
      if (other === idA || other === idB) continue;
      const otherSlot = posMap.get(other);
      if (!otherSlot) continue;
      const distO = chebyshevDist(otherSlot);
      if (pairConcordant(idA, other, distA, distO, mainState, scoreMap)) delta -= 1;
      if (pairConcordant(idA, other, distB, distO, mainState, scoreMap)) delta += 1;
      if (pairConcordant(idB, other, distB, distO, mainState, scoreMap)) delta -= 1;
      if (pairConcordant(idB, other, distA, distO, mainState, scoreMap)) delta += 1;
    }
    return delta;
  }

  /** Δ qualité en déplaçant playerId vers toSlot (laisse FREE derrière) — O(n). */
  function qualityDeltaForMoveToEmpty(posMap, movableIds, playerId, toSlot, mainState, scoreMap) {
    const fromSlot = posMap.get(playerId);
    if (!fromSlot || !toSlot) return 0;
    const distFrom = chebyshevDist(fromSlot);
    const distTo = chebyshevDist(toSlot);
    let delta = 0;
    for (let i = 0; i < movableIds.length; i += 1) {
      const other = movableIds[i];
      if (other === playerId) continue;
      const otherSlot = posMap.get(other);
      if (!otherSlot) continue;
      const distO = chebyshevDist(otherSlot);
      if (pairConcordant(playerId, other, distFrom, distO, mainState, scoreMap)) delta -= 1;
      if (pairConcordant(playerId, other, distTo, distO, mainState, scoreMap)) delta += 1;
    }
    return delta;
  }

  function maxPlacementQuality(n) {
    if (n < 2) return 1;
    return (n * (n - 1)) / 2;
  }

  /** Joueur sans inversion vs les autres : déjà bien placé → ne jamais le déplacer. */
  function isWellPlaced(playerId, posMap, movableIds, mainState, scoreMap) {
    const mySlot = posMap.get(playerId);
    if (!mySlot) return false;
    const myPower = playerPowerValue(playerId, mainState, scoreMap);
    if (myPower == null) return true;
    const myDist = chebyshevDist(mySlot);
    for (let i = 0; i < movableIds.length; i += 1) {
      const otherId = movableIds[i];
      if (otherId === playerId) continue;
      const otherSlot = posMap.get(otherId);
      if (!otherSlot) continue;
      const otherPower = playerPowerValue(otherId, mainState, scoreMap);
      if (otherPower == null || myPower === otherPower) continue;
      const otherDist = chebyshevDist(otherSlot);
      if (myPower > otherPower && myDist > otherDist) return false;
      if (myPower < otherPower && myDist < otherDist) return false;
    }
    return true;
  }

  function getProposalMode() {
    const el = document.getElementById('rucheProposalMode');
    return el?.value === 'full' ? 'full' : 'soft';
  }

  /** Déplacement auto R4/R5 : uniquement en plan complet + case cochée (off par défaut). */
  function getAllowOfficerMoves() {
    if (getProposalMode() !== 'full') return false;
    const el = document.getElementById('rucheAllowOfficerMoves');
    return Boolean(el?.checked);
  }

  function syncOfficerMovesOptionVisibility() {
    const wrap = document.getElementById('rucheAllowOfficerMovesWrap');
    if (!wrap) return;
    wrap.hidden = getProposalMode() !== 'full';
  }

  /**
   * soft — optimisation douce (peu de déplacements, R4/R5 toujours verrouillés)
   * full — nouveau plan complet ; R4/R5 conservés sauf allowOfficerMoves
   */
  function buildOptimizedProposal(sourceGrid, sourceBottom, options = {}) {
    const mode = options.mode === 'full' ? 'full' : 'soft';
    // Soft : jamais. Full : seulement si option explicite.
    const allowOfficerMoves = mode === 'full' && options.allowOfficerMoves === true;
    const hive = {
      grid: cloneGrid(sourceGrid),
      bottomId: normalizeCellValue(sourceBottom, { allowFree: true }),
    };
    const mainState = ROSStorage.getState();
    const scoreMap = buildRuchePowerScoreMap(mainState);
    const lockOpts = { mode, allowOfficerMoves };
    const unlockedSlots = [];
    const movableIds = [];

    for (let r = 0; r < GRID_SIZE; r += 1) {
      for (let c = 0; c < GRID_SIZE; c += 1) {
        if (isMarshalCell(r, c)) continue;
        const slot = { type: 'grid', row: r, col: c };
        if (isLockedSlotOnHive(hive, slot, lockOpts)) continue;
        unlockedSlots.push(slot);
        const value = getCellValueFromHive(hive, slot);
        if (value && value !== FREE) movableIds.push(value);
      }
    }

    const bottomSlot = { type: 'bottom' };
    if (!isLockedSlotOnHive(hive, bottomSlot, lockOpts)) {
      unlockedSlots.push(bottomSlot);
      const value = getCellValueFromHive(hive, bottomSlot);
      if (value && value !== FREE) movableIds.push(value);
    }

    const uniqueMovable = [];
    const seen = new Set();
    movableIds.forEach((id) => {
      if (seen.has(id)) return;
      // Sécurité : les officiers ne sont jamais dans le pool d’optimisation
      // sauf autorisation explicite (plan complet + case cochée).
      if (!allowOfficerMoves && isOfficerPlayer(getPlayerById(id))) return;
      seen.add(id);
      uniqueMovable.push(id);
    });

    const baseResult = () => ({
      grid: cloneGrid(sourceGrid),
      bottomId: normalizeCellValue(sourceBottom, { allowFree: true }),
      generatedAt: new Date().toISOString(),
      mode,
      allowOfficerMoves,
    });

    if (uniqueMovable.length < 2) {
      return baseResult();
    }

    const maxQ = maxPlacementQuality(uniqueMovable.length);
    const TARGET_RATIO = mode === 'full' ? 0.98 : 0.95;
    const MOVE_SOFT_CAP =
      mode === 'full'
        ? uniqueMovable.length
        : Math.max(8, Math.min(14, Math.ceil(uniqueMovable.length * 0.1)));
    const MOVE_PENALTY =
      mode === 'full' ? 0 : Math.max(0, Math.floor(Math.sqrt(maxQ) * 0.2) - 1);

    const initialPositions = collectPlayerPositions(hive.grid, hive.bottomId);
    const posMap = () => collectPlayerPositions(hive.grid, hive.bottomId);

    let quality = placementQuality(posMap(), uniqueMovable, mainState, scoreMap);
    if (mode === 'soft' && quality / maxQ >= TARGET_RATIO) {
      return baseResult();
    }

    const maxPasses =
      mode === 'full'
        ? Math.min(120, uniqueMovable.length * 4)
        : Math.min(50, uniqueMovable.length * 2);
    for (let pass = 0; pass < maxPasses; pass += 1) {
      const positions = posMap();
      quality = placementQuality(positions, uniqueMovable, mainState, scoreMap);
      if (quality / maxQ >= TARGET_RATIO) break;

      let movedNow = 0;
      positions.forEach((slot, playerId) => {
        const from = initialPositions.get(playerId);
        if (!from || !sameSlot(from, slot)) movedNow += 1;
      });
      if (mode === 'soft' && movedNow >= MOVE_SOFT_CAP && quality / maxQ >= 0.9) break;

      const wellPlaced = new Set();
      if (mode === 'soft') {
        uniqueMovable.forEach((id) => {
          if (isWellPlaced(id, positions, uniqueMovable, mainState, scoreMap)) {
            wellPlaced.add(id);
          }
        });
      }

      const emptySlots = unlockedSlots.filter((slot) => {
        const value = getCellValueFromHive(hive, slot);
        return !value || value === FREE;
      });

      let best = null;

      const consider = (slotA, slotB, valA, valB, delta, moves) => {
        const net = delta - MOVE_PENALTY * moves;
        if (delta <= 0 || net < 0) return;
        if (
          !best ||
          net > best.net ||
          (net === best.net && delta > best.delta) ||
          (net === best.net && delta === best.delta && moves < best.moves)
        ) {
          best = { slotA, slotB, valA, valB, net, delta, moves };
        }
      };

      for (let i = 0; i < uniqueMovable.length; i += 1) {
        for (let j = i + 1; j < uniqueMovable.length; j += 1) {
          const idA = uniqueMovable[i];
          const idB = uniqueMovable[j];
          if (wellPlaced.has(idA) || wellPlaced.has(idB)) continue;
          const slotA = positions.get(idA);
          const slotB = positions.get(idB);
          if (!slotA || !slotB) continue;
          const pA = playerPowerValue(idA, mainState, scoreMap);
          const pB = playerPowerValue(idB, mainState, scoreMap);
          if (pA == null || pB == null || pA === pB) continue;
          const stronger = pA > pB ? idA : idB;
          const weaker = pA > pB ? idB : idA;
          const strongSlot = stronger === idA ? slotA : slotB;
          const weakSlot = weaker === idA ? slotA : slotB;
          if (chebyshevDist(strongSlot) <= chebyshevDist(weakSlot)) continue;
          const delta = qualityDeltaForSwap(
            positions,
            uniqueMovable,
            idA,
            idB,
            mainState,
            scoreMap
          );
          consider(slotA, slotB, idA, idB, delta, 2);
        }
      }

      uniqueMovable.forEach((playerId) => {
        if (wellPlaced.has(playerId)) return;
        const fromSlot = positions.get(playerId);
        if (!fromSlot) return;
        const fromDist = chebyshevDist(fromSlot);
        emptySlots.forEach((toSlot) => {
          if (chebyshevDist(toSlot) >= fromDist) return;
          const delta = qualityDeltaForMoveToEmpty(
            positions,
            uniqueMovable,
            playerId,
            toSlot,
            mainState,
            scoreMap
          );
          consider(fromSlot, toSlot, playerId, FREE, delta, 1);
        });
      });

      if (!best) break;
      setHiveSlot(hive, best.slotA, best.valB);
      setHiveSlot(hive, best.slotB, best.valA);
    }

    return {
      grid: hive.grid,
      bottomId: hive.bottomId,
      generatedAt: new Date().toISOString(),
      mode,
      allowOfficerMoves,
    };
  }

  function computeIdealQuality(movableIds, mainState) {
    return maxPlacementQuality(movableIds.length);
  }

  function computeProposalStats(currentGrid, currentBottom, proposalGrid, proposalBottom) {
    const fromMap = collectPlayerPositions(currentGrid, currentBottom);
    const toMap = collectPlayerPositions(proposalGrid, proposalBottom);
    let kept = 0;
    let moved = 0;
    fromMap.forEach((fromPos, playerId) => {
      const toPos = toMap.get(playerId);
      if (toPos && sameSlot(fromPos, toPos)) kept += 1;
      else moved += 1;
    });

    const mainState = ROSStorage.getState();
    const scoreMap = buildRuchePowerScoreMap(mainState);
    const movableIds = [];
    const seen = new Set();
    fromMap.forEach((_pos, playerId) => {
      if (seen.has(playerId)) return;
      if (isOfficerPlayer(getPlayerById(playerId))) return;
      seen.add(playerId);
      movableIds.push(playerId);
    });

    const maxQ = computeIdealQuality(movableIds, mainState);
    const qProposal = placementQuality(toMap, movableIds, mainState, scoreMap);
    const estimatedGainPct = Math.round((100 * qProposal) / Math.max(1, maxQ));

    return {
      kept,
      moved,
      total: fromMap.size,
      estimatedGainPct,
      optimizationPct: estimatedGainPct,
    };
  }

  function ensureProposal(force = false, options = {}) {
    const s = getState();
    if (!force && s.proposal && Array.isArray(s.proposal.grid)) return s.proposal;
    const mode = options.mode || getProposalMode();
    const allowOfficerMoves =
      mode === 'full' &&
      (options.allowOfficerMoves === true ||
        (options.allowOfficerMoves == null && getAllowOfficerMoves()));
    s.proposal = buildOptimizedProposal(s.grid, s.bottomId, { mode, allowOfficerMoves });
    persist();
    return s.proposal;
  }

  function regenerateProposal() {
    const mode = getProposalMode();
    const allowOfficerMoves = getAllowOfficerMoves();
    ensureProposal(true, { mode, allowOfficerMoves });
    render();
    AppUI.toast(
      mode === 'full'
        ? allowOfficerMoves
          ? 'Nouveau plan complet généré (R4/R5 déplaçables).'
          : 'Nouveau plan complet généré (R4/R5 conservés).'
        : 'Optimisation douce recalculée.'
    );
  }

  function updateProposal(mutator) {
    const s = getState();
    if (!s.proposal) ensureProposal(true);
    const draft = {
      grid: cloneGrid(s.proposal.grid),
      bottomId: s.proposal.bottomId,
      generatedAt: s.proposal.generatedAt || '',
      mode: s.proposal.mode,
      allowOfficerMoves: s.proposal.allowOfficerMoves === true,
    };
    const next = mutator(draft) || draft;
    s.proposal = {
      grid: normalizeGrid(next.grid),
      bottomId: normalizeCellValue(next.bottomId, { allowFree: true }),
      generatedAt: next.generatedAt || s.proposal.generatedAt || '',
      mode: next.mode || s.proposal.mode || getProposalMode(),
      allowOfficerMoves: next.allowOfficerMoves === true,
    };
    persist();
    render();
  }

  function removePlayerFromProposal(hive, playerId, keep) {
    if (!playerId || playerId === FREE) return;
    for (let r = 0; r < GRID_SIZE; r += 1) {
      for (let c = 0; c < GRID_SIZE; c += 1) {
        if (keep?.type === 'grid' && keep.row === r && keep.col === c) continue;
        if (hive.grid[r][c] === playerId) hive.grid[r][c] = FREE;
      }
    }
    if (!(keep?.type === 'bottom') && hive.bottomId === playerId) hive.bottomId = FREE;
  }

  function proposalLockOptions(hive) {
    const mode = hive?.mode || getProposalMode();
    const allowOfficerMoves =
      mode === 'full' &&
      (hive?.allowOfficerMoves === true ||
        (hive?.allowOfficerMoves == null && getAllowOfficerMoves()));
    return { mode: mode === 'full' ? 'full' : 'soft', allowOfficerMoves };
  }

  function setProposalSlot(slot, value) {
    if (!slot) return;
    updateProposal((hive) => {
      if (isLockedSlotOnHive(hive, slot, proposalLockOptions(hive))) return hive;
      let next = normalizeCellValue(value, { allowFree: true });
      if (next && next !== FREE) removePlayerFromProposal(hive, next, slot);
      setHiveSlot(hive, slot, next);
      return hive;
    });
  }

  function swapProposalSlots(slotA, slotB) {
    if (!slotA || !slotB || sameSlot(slotA, slotB)) return;
    updateProposal((hive) => {
      const lockOpts = proposalLockOptions(hive);
      if (isLockedSlotOnHive(hive, slotA, lockOpts) || isLockedSlotOnHive(hive, slotB, lockOpts)) {
        return hive;
      }
      const a = getCellValueFromHive(hive, slotA);
      const b = getCellValueFromHive(hive, slotB);
      setHiveSlot(hive, slotA, b || FREE);
      setHiveSlot(hive, slotB, a || FREE);
      return hive;
    });
  }

  function archiveCurrentHive(labelPrefix = 'Ruche') {
    const s = getState();
    const check = analyzeGrid();
    const stamp = new Date();
    const label = `${labelPrefix} ${stamp.toLocaleDateString('fr-FR')} ${stamp.toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
    })}`;
    const active = getActivePlayers();
    s.archives.unshift({
      id: uid('ruche'),
      label,
      createdAt: stamp.toISOString(),
      grid: cloneGrid(s.grid),
      marshalId: getMarshalId(s.grid),
      bottomId: getBottomId(s),
      colors: { ...s.colors },
      placedCount: check.placedCount,
      freeCount: check.freeCount,
      caseCount: TOTAL_CASES,
      players: active.map((p) => ({ id: p.id, pseudo: p.pseudo, role: p.role })),
    });
  }

  async function validateProposal() {
    ensureProposal(false);
    const s = getState();
    const proposal = s.proposal;
    if (!proposal) {
      AppUI.toast('Aucune proposition à valider.');
      return;
    }
    const stats = computeProposalStats(s.grid, s.bottomId, proposal.grid, proposal.bottomId);
    const ok = await AppUI.confirm({
      title: 'Valider cette proposition comme nouvelle ruche',
      message: `Remplacer directement la ruche actuelle par la proposition ?\n\nGain estimé : ${stats.estimatedGainPct} %\nDéplacements : ${stats.moved} joueurs\n\nAucune archive ne sera créée.`,
      confirmLabel: 'Valider comme nouvelle ruche',
    });
    if (!ok) return;

    // Remplace la ruche actuelle sans archivage ni historique
    s.grid = cloneGrid(proposal.grid);
    s.bottomId = normalizeCellValue(proposal.bottomId, { allowFree: true });
    s.proposal = buildOptimizedProposal(s.grid, s.bottomId, {
      mode: 'soft',
      allowOfficerMoves: false,
    });
    persist();
    lastCheck = null;
    render();
    AppUI.toast('Proposition validée — nouvelle ruche actuelle.');
  }

  /**
   * Couleur d’une case de la grille :
   * Maréchal → violet ; R5/R4 → bleu ; FREE → noir ; sinon pastel du cadre.
   */
  function colorForGridCell(row, col, value, playerLookup = getPlayerById) {
    const colors = getColors();
    if (isMarshalCell(row, col)) return colors.marshal;
    if (!value) return 'transparent';
    if (value === FREE) return colors.free;
    const player = playerLookup(value);
    if (player && isOfficerRole(player.role)) return colors.r4;
    return ringPastel(row, col);
  }

  /** Couleur hors grille (case du bas) : rôles / FREE / pastel extérieur. */
  function colorForValue(value, playerLookup = getPlayerById) {
    const colors = getColors();
    if (!value) return 'transparent';
    if (value === FREE) return colors.free;
    const player = playerLookup(value);
    if (player && isOfficerRole(player.role)) return colors.r4;
    return RING_PASTELS[0];
  }

  function labelForValue(value) {
    if (!value) return '';
    if (value === FREE) return 'FREE';
    const player = getPlayerById(value);
    return player ? player.pseudo : '—';
  }

  function textColorForBg(hex) {
    if (!hex || hex === 'transparent') return '#e8ecf1';
    const raw = hex.replace('#', '');
    if (raw.length !== 6) return '#e8ecf1';
    const r = parseInt(raw.slice(0, 2), 16);
    const g = parseInt(raw.slice(2, 4), 16);
    const b = parseInt(raw.slice(4, 6), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.55 ? '#121417' : '#f5f7fa';
  }

  function analyzeGrid() {
    const s = getState();
    const grid = s.grid;
    const bottomId = getBottomId(s);
    const active = getActivePlayers();
    const activeIds = new Set(active.map((p) => p.id));
    const placed = [];
    const counts = new Map();
    let freeCount = 0;
    let emptyPlayerSlots = 0;
    let playersInPlayerSlots = 0;
    const unknownIds = new Set();
    const issues = [];

    // Maréchal : uniquement la case à position fixe (pas le libellé UI)
    let marshalId = getMarshalId(grid);
    if (!marshalId) {
      const fromDom = readMarshalIdFromDom();
      if (fromDom) marshalId = fromDom;
    }

    let caseCount = 0;
    let playerSlotCount = 0;

    const registerPlayer = (id, source, row, col) => {
      placed.push({ id, source, row, col });
      counts.set(id, (counts.get(id) || 0) + 1);
      const player = getPlayerById(id);
      if (!player || player.status !== 'Actif') unknownIds.add(id);
    };

    grid.forEach((row, r) => {
      row.forEach((rawCell, c) => {
        caseCount += 1;
        const marshal = isMarshalCell(r, c);
        const cell = normalizeCellValue(rawCell, { allowFree: !marshal });

        if (marshal) {
          if (rawCell === FREE || rawCell === 'FREE') {
            issues.push('La case Maréchal ne peut pas être FREE');
          }
          // Le Maréchal n'est jamais une des 100 cases joueurs
          if (cell) registerPlayer(cell, 'marshal', r, c);
          return;
        }

        playerSlotCount += 1;
        if (!cell) {
          emptyPlayerSlots += 1;
          return;
        }
        if (cell === FREE) {
          freeCount += 1;
          return;
        }
        playersInPlayerSlots += 1;
        registerPlayer(cell, 'grid', r, c);
      });
    });

    // Case du bas = 101ᵉ case, slot joueur (FREE autorisé)
    caseCount += 1;
    playerSlotCount += 1;
    if (!bottomId) {
      emptyPlayerSlots += 1;
    } else if (bottomId === FREE) {
      freeCount += 1;
    } else {
      playersInPlayerSlots += 1;
      registerPlayer(bottomId, 'bottom');
    }

    if (!marshalId) {
      issues.push('Maréchal non renseigné');
    } else if (!activeIds.has(marshalId)) {
      issues.push('Le Maréchal doit être un joueur actif');
    }

    if (emptyPlayerSlots > 0) {
      issues.push(
        `Cases joueurs vides : ${emptyPlayerSlots} (marquez-les FREE si aucun joueur)`
      );
    }

    // FREE valides : joueurs dans slots + FREE = 100 (pas d'exigence artificielle de 100 actifs)
    if (
      emptyPlayerSlots === 0 &&
      playersInPlayerSlots + freeCount !== PLAYER_SLOTS
    ) {
      issues.push(
        `Cases joueurs incohérentes : ${playersInPlayerSlots} joueurs + ${freeCount} FREE ≠ ${PLAYER_SLOTS}`
      );
    }

    const duplicates = [];
    counts.forEach((count, id) => {
      if (count > 1) {
        const player = getPlayerById(id);
        duplicates.push({
          id,
          pseudo: player ? player.pseudo : id,
          count,
        });
      }
    });

    const placedUnique = new Set(placed.map((p) => p.id));
    const missing = active.filter((p) => !placedUnique.has(p.id));
    const extras = [...placedUnique].filter((id) => !activeIds.has(id));

    const slotsConsistent =
      emptyPlayerSlots === 0 && playersInPlayerSlots + freeCount === PLAYER_SLOTS;

    const canValidate =
      caseCount === TOTAL_CASES &&
      playerSlotCount === PLAYER_SLOTS &&
      Boolean(marshalId) &&
      activeIds.has(marshalId) &&
      slotsConsistent &&
      duplicates.length === 0 &&
      missing.length === 0 &&
      unknownIds.size === 0 &&
      extras.length === 0;

    return {
      ok: canValidate,
      caseCount,
      playerSlotCount,
      placedCount: placedUnique.size,
      playersInPlayerSlots,
      totalActive: active.length,
      freeCount,
      emptyPlayerSlots,
      marshalId,
      marshalMissing: !marshalId,
      marshalPseudo: marshalId
        ? getPlayerById(marshalId)?.pseudo || marshalId
        : null,
      bottomId,
      duplicates,
      missing,
      issues,
      partiIds: [...unknownIds].map((id) => {
        const p = getPlayerById(id);
        return { id, pseudo: p ? p.pseudo : id };
      }),
      extras: extras.map((id) => {
        const p = getPlayerById(id);
        return { id, pseudo: p ? `${p.pseudo} (${p.status})` : id };
      }),
      canValidate,
    };
  }

  function cacheDom() {
    els.root = document.getElementById('panel-ruche');
    els.board = document.getElementById('rucheBoard');
    els.grid = document.getElementById('rucheGrid');
    els.verifyResult = document.getElementById('rucheVerifyResult');
    els.btnVerify = document.getElementById('rucheVerify');
    els.btnValidate = document.getElementById('rucheValidate');
    els.btnExportPng = document.getElementById('rucheExportPng');
    els.btnExportExcel = document.getElementById('rucheExportExcel');
    els.btnClear = document.getElementById('rucheClear');
    els.archivesList = document.getElementById('rucheArchivesList');
    els.archivesEmpty = document.getElementById('rucheArchivesEmpty');
    els.archivePreview = document.getElementById('rucheArchivePreview');
    els.colorMarshal = document.getElementById('rucheColorMarshal');
    els.colorR4 = document.getElementById('rucheColorR4');
    els.colorFree = document.getElementById('rucheColorFree');
    els.proposalBoard = document.getElementById('rucheProposalBoard');
    els.proposalGrid = document.getElementById('rucheProposalGrid');
    els.proposalStats = document.getElementById('rucheProposalStats');
    els.btnProposalOptimize = document.getElementById('rucheProposalOptimize');
    els.btnProposalValidate = document.getElementById('rucheProposalValidate');
    els.proposalMode = document.getElementById('rucheProposalMode');
    els.allowOfficerMoves = document.getElementById('rucheAllowOfficerMoves');
  }

  function buildOptions(currentValue, except, { allowFree = true, emptyLabel = '—' } = {}) {
    const used = getUsedPlayerIdsExcept(except);
    const players = getActivePlayers().filter((p) => !used.has(p.id) || p.id === currentValue);
    const opts = [`<option value="">${escapeHtml(emptyLabel)}</option>`];
    if (allowFree) {
      opts.push(
        `<option value="${FREE}" ${currentValue === FREE ? 'selected' : ''}>FREE</option>`
      );
    }
    players.forEach((p) => {
      const selected = p.id === currentValue ? 'selected' : '';
      const roleMark = p.role === 'R5' ? ' · R5' : p.role === 'R4' ? ' · R4' : '';
      opts.push(
        `<option value="${p.id}" ${selected}>${escapeHtml(p.pseudo)}${roleMark}</option>`
      );
    });
    return opts.join('');
  }

  function getProposalUsedExcept(except) {
    const proposal = getState().proposal;
    const used = new Set();
    if (!proposal) return used;
    for (let r = 0; r < GRID_SIZE; r += 1) {
      for (let c = 0; c < GRID_SIZE; c += 1) {
        if (except?.type === 'grid' && except.row === r && except.col === c) continue;
        const value = proposal.grid?.[r]?.[c];
        if (value && value !== FREE) used.add(value);
      }
    }
    if (!(except?.type === 'bottom')) {
      const bottom = proposal.bottomId;
      if (bottom && bottom !== FREE) used.add(bottom);
    }
    return used;
  }

  function buildProposalOptions(
    currentValue,
    except,
    { allowFree = true, emptyLabel = '—', locked = false } = {}
  ) {
    if (locked) {
      const label = labelForValue(currentValue) || emptyLabel;
      const val = currentValue || '';
      return `<option value="${escapeHtml(val)}" selected>${escapeHtml(label)}</option>`;
    }
    const used = getProposalUsedExcept(except);
    const players = getActivePlayers().filter((p) => !used.has(p.id) || p.id === currentValue);
    const opts = [`<option value="">${escapeHtml(emptyLabel)}</option>`];
    if (allowFree) {
      opts.push(
        `<option value="${FREE}" ${currentValue === FREE ? 'selected' : ''}>FREE</option>`
      );
    }
    players.forEach((p) => {
      const selected = p.id === currentValue ? 'selected' : '';
      const roleMark = p.role === 'R5' ? ' · R5' : p.role === 'R4' ? ' · R4' : '';
      opts.push(
        `<option value="${p.id}" ${selected}>${escapeHtml(p.pseudo)}${roleMark}</option>`
      );
    });
    return opts.join('');
  }

  function renderProposalStats() {
    if (!els.proposalStats) return;
    const s = getState();
    const proposal = s.proposal;
    if (!proposal) {
      els.proposalStats.textContent = 'Gain estimé : 0 % · Déplacements : 0 joueurs';
      return;
    }
    const stats = computeProposalStats(s.grid, s.bottomId, proposal.grid, proposal.bottomId);
    els.proposalStats.innerHTML = `Gain estimé : <strong>${stats.estimatedGainPct} %</strong> · Déplacements : <strong>${stats.moved}</strong> joueurs`;
  }

  function renderProposalBottom(hive) {
    const bottomId = hive.bottomId;
    const locked = isLockedSlotOnHive(hive, { type: 'bottom' }, proposalLockOptions(hive));
    const bg = colorForValue(bottomId);
    const fg = textColorForBg(bg === 'transparent' ? '#1e232b' : bg);
    const filled = Boolean(bottomId);
    return `
      <div class="ruche-footer">
        <div
          class="ruche-cell ruche-bottom-cell ${filled ? 'is-filled' : ''} ${locked ? 'is-locked' : ''}"
          data-proposal-cell
          data-slot-type="bottom"
          data-locked="${locked ? '1' : '0'}"
          draggable="${locked ? 'false' : 'true'}"
          data-value="${escapeHtml(bottomId || '')}"
          style="${filled ? `background:${bg};color:${fg};border-color:${bg}` : ''}"
        >
          <span class="ruche-cell-coord">Bas</span>
          <select
            class="input ruche-cell-select"
            data-proposal-bottom-select
            ${locked ? 'disabled' : ''}
            aria-label="Proposition — case du bas"
          >
            ${buildProposalOptions(bottomId, { type: 'bottom' }, {
              allowFree: true,
              emptyLabel: '—',
              locked,
            })}
          </select>
          <span class="ruche-cell-label" aria-hidden="true">${escapeHtml(labelForValue(bottomId))}</span>
        </div>
      </div>
    `;
  }

  function renderProposalGrid() {
    if (!els.proposalGrid || !els.proposalBoard) return;
    ensureProposal(false);
    const hive = getState().proposal;
    if (!hive) return;
    const cells = [];
    for (let r = 0; r < GRID_SIZE; r += 1) {
      for (let c = 0; c < GRID_SIZE; c += 1) {
        const value = hive.grid[r][c];
        const marshal = isMarshalCell(r, c);
        const slot = { type: 'grid', row: r, col: c };
        const locked = isLockedSlotOnHive(hive, slot, proposalLockOptions(hive));
        const bg = colorForGridCell(r, c, value);
        const fg = textColorForBg(bg === 'transparent' ? '#1e232b' : bg);
        const filled = Boolean(value) || marshal;
        cells.push(`
          <div
            class="ruche-cell ${filled ? 'is-filled' : ''} ${marshal ? 'ruche-cell-marshal' : ''} ${
              locked ? 'is-locked' : ''
            }"
            role="gridcell"
            data-proposal-cell
            data-slot-type="grid"
            data-row="${r}"
            data-col="${c}"
            data-locked="${locked ? '1' : '0'}"
            draggable="${locked || marshal ? 'false' : 'true'}"
            data-value="${escapeHtml(value || '')}"
            style="background:${marshal || value ? bg : 'var(--bg-elevated)'};color:${fg};border-color:${
              marshal || value ? bg : 'var(--border-soft)'
            }"
          >
            ${
              marshal
                ? '<span class="ruche-marshal-badge">Maréchal</span>'
                : `<span class="ruche-cell-coord">${r + 1},${c + 1}</span>`
            }
            <select
              class="input ruche-cell-select ${marshal ? 'ruche-marshal-select' : ''}"
              data-proposal-select
              data-row="${r}"
              data-col="${c}"
              ${locked || marshal ? 'disabled' : ''}
              aria-label="${marshal ? 'Proposition — Maréchal' : `Proposition — case ${r + 1}, ${c + 1}`}"
            >
              ${buildProposalOptions(value, { type: 'grid', row: r, col: c }, {
                allowFree: !marshal,
                emptyLabel: marshal ? '— Maréchal —' : '—',
                locked: locked || marshal,
              })}
            </select>
            <span class="ruche-cell-label" aria-hidden="true">${escapeHtml(labelForValue(value))}</span>
          </div>
        `);
      }
    }
    els.proposalGrid.style.setProperty('--ruche-cols', String(GRID_SIZE));
    els.proposalGrid.innerHTML = cells.join('');
    const existingFooter = els.proposalBoard.querySelector('.ruche-footer');
    if (existingFooter) existingFooter.remove();
    els.proposalBoard.insertAdjacentHTML('beforeend', renderProposalBottom(hive));
    renderProposalStats();
  }

  function renderBottomSlot() {
    const bottomId = getBottomId();
    const bg = colorForValue(bottomId);
    const fg = textColorForBg(bg === 'transparent' ? '#1e232b' : bg);
    const filled = Boolean(bottomId);
    return `
      <div class="ruche-footer">
        <div
          class="ruche-cell ruche-bottom-cell ${filled ? 'is-filled' : ''}"
          data-ruche-bottom
          data-value="${escapeHtml(bottomId || '')}"
          style="${filled ? `background:${bg};color:${fg};border-color:${bg}` : ''}"
        >
          <span class="ruche-cell-coord">Bas</span>
          <select
            class="input ruche-cell-select"
            data-ruche-bottom-select
            aria-label="Case du bas — joueur"
          >
            ${buildOptions(bottomId, { type: 'bottom' }, { allowFree: true, emptyLabel: '—' })}
          </select>
          <span class="ruche-cell-label" aria-hidden="true">${escapeHtml(labelForValue(bottomId))}</span>
        </div>
      </div>
    `;
  }

  function renderGrid() {
    if (!els.grid || !els.board) return;
    const grid = getState().grid;
    const cells = [];
    for (let r = 0; r < GRID_SIZE; r += 1) {
      for (let c = 0; c < GRID_SIZE; c += 1) {
        const value = grid[r][c];
        const marshal = isMarshalCell(r, c);
        const bg = colorForGridCell(r, c, value);
        const fg = textColorForBg(bg === 'transparent' ? '#1e232b' : bg);
        const filled = Boolean(value) || marshal;
        cells.push(`
          <div
            class="ruche-cell ${filled ? 'is-filled' : ''} ${marshal ? 'ruche-cell-marshal' : ''}"
            role="gridcell"
            data-ruche-cell
            data-row="${r}"
            data-col="${c}"
            data-marshal="${marshal ? '1' : '0'}"
            data-value="${escapeHtml(value || '')}"
            style="background:${marshal || value ? bg : 'var(--bg-elevated)'};color:${fg};border-color:${marshal || value ? bg : 'var(--border-soft)'}"
          >
            ${
              marshal
                ? '<span class="ruche-marshal-badge">Maréchal</span>'
                : `<span class="ruche-cell-coord">${r + 1},${c + 1}</span>`
            }
            <select
              class="input ruche-cell-select ${marshal ? 'ruche-marshal-select' : ''}"
              data-ruche-select
              data-row="${r}"
              data-col="${c}"
              aria-label="${marshal ? 'Case Maréchal' : `Case ${r + 1}, ${c + 1}`}"
            >
              ${buildOptions(value, { type: 'grid', row: r, col: c }, {
                allowFree: !marshal,
                emptyLabel: marshal ? '— Maréchal —' : '—',
              })}
            </select>
            <span class="ruche-cell-label" aria-hidden="true">${escapeHtml(labelForValue(value))}</span>
          </div>
        `);
      }
    }
    els.grid.style.setProperty('--ruche-cols', String(GRID_SIZE));
    els.grid.innerHTML = cells.join('');

    const existingFooter = els.board.querySelector('.ruche-footer');
    if (existingFooter) existingFooter.remove();
    els.board.insertAdjacentHTML('beforeend', renderBottomSlot());
  }

  function renderVerifyResult(check) {
    if (!els.verifyResult) return;
    if (!check) {
      els.verifyResult.innerHTML = '';
      return;
    }

    const missingList = check.missing.length
      ? `<ul class="ruche-missing-list">${check.missing
          .map((p) => `<li>${escapeHtml(p.pseudo)}</li>`)
          .join('')}</ul>`
      : '';

    const issues = [...(check.issues || [])];
    if (check.duplicates.length) {
      issues.push(
        `Doublons détectés : ${check.duplicates
          .map((d) => `${escapeHtml(d.pseudo)} (×${d.count})`)
          .join(', ')}`
      );
    }
    if (check.partiIds.length) {
      issues.push(
        `Valeurs inconnues / joueurs non actifs : ${check.partiIds
          .map((p) => escapeHtml(p.pseudo))
          .join(', ')}`
      );
    }
    if (check.extras.length) {
      issues.push(
        `Hors effectif actif : ${check.extras.map((p) => escapeHtml(p.pseudo)).join(', ')}`
      );
    }

    const marshalLabel = check.marshalPseudo
      ? escapeHtml(check.marshalPseudo)
      : check.marshalId
        ? escapeHtml(labelForValue(check.marshalId) || check.marshalId)
        : '—';

    const cls = check.canValidate ? 'train-ok' : 'train-errors';
    els.verifyResult.innerHTML = `
      <div class="${cls}">
        <strong>Résultat de la vérification</strong>
        <ul class="ruche-stats">
          <li>Cases totales : ${check.caseCount} / ${TOTAL_CASES}</li>
          <li>Cases joueurs : ${check.playerSlotCount} / ${PLAYER_SLOTS}</li>
          <li>Joueurs actifs attendus : ${check.totalActive}</li>
          <li>Joueurs placés : ${check.placedCount}</li>
          <li>Cases FREE : ${check.freeCount}</li>
          <li>Maréchal : ${marshalLabel}</li>
          <li>Doublons : ${check.duplicates.length}</li>
          <li>Joueurs manquants : ${check.missing.length}</li>
        </ul>
        ${
          check.missing.length
            ? `<p><strong>Joueurs manquants</strong></p>${missingList}`
            : ''
        }
        ${issues.length ? `<p>${issues.join('<br>')}</p>` : ''}
        ${
          check.canValidate
            ? `<p>Ruche valide — ${check.totalActive} joueurs actifs, ${check.freeCount} FREE, Maréchal : ${marshalLabel}.</p>`
            : ''
        }
      </div>
    `;
  }

  function renderArchives() {
    if (!els.archivesList) return;
    const archives = getState().archives;
    if (!archives.length) {
      els.archivesList.innerHTML = '';
      if (els.archivesEmpty) els.archivesEmpty.classList.remove('hidden');
      if (els.archivePreview) {
        els.archivePreview.classList.add('hidden');
        els.archivePreview.innerHTML = '';
      }
      return;
    }
    if (els.archivesEmpty) els.archivesEmpty.classList.add('hidden');
    els.archivesList.innerHTML = archives
      .map((arch) => {
        const date = arch.createdAt
          ? new Date(arch.createdAt).toLocaleString('fr-FR')
          : '—';
        return `
          <article class="stack-item">
            <div class="stack-item-main">
              <h4 class="stack-item-title">${escapeHtml(arch.label || 'Plan ruche')}</h4>
              <p class="panel-subtitle">${escapeHtml(date)} · ${arch.placedCount || 0} joueurs · ${arch.freeCount || 0} FREE</p>
            </div>
            <button type="button" class="btn btn-ghost btn-sm" data-ruche-action="view-archive" data-id="${arch.id}">
              Consulter
            </button>
          </article>
        `;
      })
      .join('');
  }

  function resolveArchivedLabel(arch, playerId) {
    if (!playerId) return '';
    if (playerId === FREE) return 'FREE';
    const snap = (arch.players || []).find((p) => p.id === playerId);
    const live = getPlayerById(playerId);
    // Afficher le pseudo actuel ; le snapshot ne sert que de secours
    return live?.pseudo || snap?.pseudo || '—';
  }

  function migratePlayerIdentity(players, options = {}) {
    const s = getState();
    const list =
      players ||
      (global.ROSStorage ? ROSStorage.getState().players : getActivePlayers());
    const result = ROSPlayerIdentity
      ? ROSPlayerIdentity.migrateRucheState(s, list, options)
      : { changed: false };
    if (result.changed) persist();
    return result.changed;
  }

  function archivedPlayerLookup(arch) {
    return (id) => {
      const snap = (arch.players || []).find((p) => p.id === id);
      if (snap) return snap;
      return getPlayerById(id);
    };
  }

  function showArchivePreview(archiveId) {
    const arch = getState().archives.find((a) => a.id === archiveId);
    if (!arch || !els.archivePreview) return;
    const lookup = archivedPlayerLookup(arch);
    const grid = normalizeGrid(arch.grid);
    let marshalId = getMarshalId(grid);
    if (!marshalId && arch.marshalId) marshalId = arch.marshalId;
    const bottomId = normalizeCellValue(arch.bottomId, { allowFree: true });
    const cells = [];
    for (let r = 0; r < GRID_SIZE; r += 1) {
      for (let c = 0; c < GRID_SIZE; c += 1) {
        const value = grid[r][c];
        const marshal = isMarshalCell(r, c);
        const bg = colorForGridCell(r, c, value, lookup);
        const label = resolveArchivedLabel(arch, value) || (marshal ? 'Maréchal' : '');
        const fg = textColorForBg(bg === 'transparent' ? '#1e232b' : bg);
        cells.push(`
          <div class="ruche-cell ruche-cell-readonly is-filled ${marshal ? 'ruche-cell-marshal' : ''}" style="background:${bg};color:${fg};border-color:${bg}">
            ${marshal ? '<span class="ruche-marshal-badge">Maréchal</span>' : ''}
            <span class="ruche-cell-label">${escapeHtml(label)}</span>
          </div>
        `);
      }
    }
    const bottomBg = colorForValue(bottomId, lookup);
    const bottomFg = textColorForBg(bottomBg === 'transparent' ? '#1e232b' : bottomBg);
    els.archivePreview.classList.remove('hidden');
    els.archivePreview.innerHTML = `
      <header class="block-header">
        <h3>${escapeHtml(arch.label || 'Plan archivé')}</h3>
        <p>Maréchal : ${escapeHtml(resolveArchivedLabel(arch, marshalId) || '—')} · Bas : ${escapeHtml(resolveArchivedLabel(arch, bottomId) || '—')}</p>
      </header>
      <div class="ruche-board ruche-board-preview">
        <div class="ruche-grid ruche-grid-preview">${cells.join('')}</div>
        <div class="ruche-footer">
          <div class="ruche-cell ruche-bottom-cell ruche-cell-readonly is-filled" style="background:${bottomBg};color:${bottomFg};border-color:${bottomBg}">
            <span class="ruche-cell-label">${escapeHtml(resolveArchivedLabel(arch, bottomId))}</span>
          </div>
        </div>
      </div>
    `;
  }

  function refreshValidateButton() {
    if (!els.btnValidate) return;
    els.btnValidate.disabled = !analyzeGrid().canValidate;
  }

  function renderSettings() {
    const colors = getColors();
    if (els.colorMarshal) els.colorMarshal.value = colors.marshal;
    if (els.colorR4) els.colorR4.value = colors.r4;
    if (els.colorFree) els.colorFree.value = colors.free;
  }

  function render() {
    if (!els.root) return;
    renderGrid();
    renderProposalGrid();
    renderArchives();
    renderSettings();
    if (lastCheck) renderVerifyResult(lastCheck);
    refreshValidateButton();
  }

  function verifyHive() {
    syncMarshalFromDomIfNeeded();
    lastCheck = analyzeGrid();
    renderVerifyResult(lastCheck);
    refreshValidateButton();
    AppUI.toast(
      lastCheck.canValidate
        ? 'Ruche conforme — validation possible.'
        : 'Vérification terminée — des écarts restent.'
    );
  }

  async function validateHive() {
    syncMarshalFromDomIfNeeded();
    const check = analyzeGrid();
    lastCheck = check;
    renderVerifyResult(check);
    refreshValidateButton();
    if (!check.canValidate) {
      AppUI.toast('Validation impossible — corrigez les écarts.');
      return;
    }
    const ok = await AppUI.confirm({
      title: 'Valider la ruche',
      message: 'Archiver ce plan de ruche ? Le plan courant reste modifiable ensuite.',
      confirmLabel: 'Valider et archiver',
    });
    if (!ok) return;

    update((s) => {
      archiveCurrentHive('Ruche');
      return s;
    });
    lastCheck = analyzeGrid();
    renderVerifyResult(lastCheck);
    AppUI.toast('Plan de ruche archivé.');
  }

  async function clearGrid() {
    const ok = await AppUI.confirm({
      title: 'Vider la grille',
      message: 'Retirer tous les joueurs et FREE (grille, Maréchal et case du bas) ?',
      confirmLabel: 'Vider',
    });
    if (!ok) return;
    update((s) => {
      s.grid = createEmptyGrid();
      s.bottomId = null;
      return s;
    });
    lastCheck = null;
    renderVerifyResult(null);
    AppUI.toast('Grille vidée.');
  }

  function onColorChange() {
    update((s) => {
      s.colors = {
        marshal: els.colorMarshal?.value || DEFAULT_COLORS.marshal,
        r4: els.colorR4?.value || DEFAULT_COLORS.r4,
        member: s.colors?.member || DEFAULT_COLORS.member,
        free: els.colorFree?.value || DEFAULT_COLORS.free,
      };
      return s;
    });
  }

  function onCellChange(event) {
    const proposalBottom = event.target.closest('[data-proposal-bottom-select]');
    if (proposalBottom) {
      setProposalSlot({ type: 'bottom' }, proposalBottom.value || FREE);
      return;
    }
    const proposalSelect = event.target.closest('[data-proposal-select]');
    if (proposalSelect) {
      const row = Number(proposalSelect.dataset.row);
      const col = Number(proposalSelect.dataset.col);
      let value = proposalSelect.value || FREE;
      if (isMarshalCell(row, col) && value === FREE) value = null;
      setProposalSlot({ type: 'grid', row, col }, value);
      return;
    }
    const bottomSelect = event.target.closest('[data-ruche-bottom-select]');
    if (bottomSelect) {
      setBottom(bottomSelect.value || null);
      return;
    }
    const select = event.target.closest('[data-ruche-select]');
    if (!select) return;
    const row = Number(select.dataset.row);
    const col = Number(select.dataset.col);
    let value = select.value || null;
    if (isMarshalCell(row, col) && value === FREE) value = null;
    setCell(row, col, value);
  }

  function parseProposalSlotFromEl(el) {
    if (!el) return null;
    const cell = el.closest('[data-proposal-cell]');
    if (!cell || cell.dataset.locked === '1') return null;
    if (cell.dataset.slotType === 'bottom') return { type: 'bottom' };
    return {
      type: 'grid',
      row: Number(cell.dataset.row),
      col: Number(cell.dataset.col),
    };
  }

  let proposalDragSlot = null;

  function onProposalDragStart(event) {
    if (event.target.closest('select')) {
      event.preventDefault();
      return;
    }
    const slot = parseProposalSlotFromEl(event.target);
    if (!slot) {
      event.preventDefault();
      return;
    }
    proposalDragSlot = slot;
    event.currentTarget.classList?.add?.('is-proposal-drag');
    const cell = event.target.closest('[data-proposal-cell]');
    if (cell) cell.classList.add('is-proposal-drag');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', slotKey(slot));
  }

  function onProposalDragEnd() {
    els.proposalBoard?.querySelectorAll('.is-proposal-drag, .is-proposal-drop-target').forEach((node) => {
      node.classList.remove('is-proposal-drag', 'is-proposal-drop-target');
    });
    proposalDragSlot = null;
  }

  function onProposalDragOver(event) {
    const slot = parseProposalSlotFromEl(event.target);
    if (!slot || !proposalDragSlot) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const cell = event.target.closest('[data-proposal-cell]');
    if (cell) cell.classList.add('is-proposal-drop-target');
  }

  function onProposalDragLeave(event) {
    const cell = event.target.closest('[data-proposal-cell]');
    if (cell) cell.classList.remove('is-proposal-drop-target');
  }

  function onProposalDrop(event) {
    event.preventDefault();
    const target = parseProposalSlotFromEl(event.target);
    const source = proposalDragSlot;
    const cell = event.target.closest('[data-proposal-cell]');
    if (cell) cell.classList.remove('is-proposal-drop-target');
    if (!source || !target) return;
    swapProposalSlots(source, target);
  }

  function bindProposalDnD() {
    if (!els.proposalBoard || els.proposalBoard.dataset.dndBound === '1') return;
    els.proposalBoard.dataset.dndBound = '1';
    els.proposalBoard.addEventListener('dragstart', onProposalDragStart);
    els.proposalBoard.addEventListener('dragend', onProposalDragEnd);
    els.proposalBoard.addEventListener('dragover', onProposalDragOver);
    els.proposalBoard.addEventListener('dragleave', onProposalDragLeave);
    els.proposalBoard.addEventListener('drop', onProposalDrop);
  }

  function onRootClick(event) {
    const btn = event.target.closest('[data-ruche-action]');
    if (!btn) return;
    if (btn.dataset.rucheAction === 'view-archive') {
      showArchivePreview(btn.dataset.id);
    }
  }

  function fillLabeledCell(ctx, x, y, w, h, bg, label, options = {}) {
    ctx.fillStyle = bg;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = options.stroke || '#3a424e';
    ctx.lineWidth = options.lineWidth || 1;
    ctx.strokeRect(x, y, w, h);
    if (!label && !options.badge) return;
    ctx.fillStyle = textColorForBg(bg);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const maxWidth = w - 10;
    if (options.badge) {
      ctx.font = '700 11px Segoe UI, Candara, sans-serif';
      ctx.fillText(options.badge, x + w / 2, y + h / 2 - (label ? 10 : 0), maxWidth);
    }
    if (label) {
      let fontSize = options.fontSize || 14;
      ctx.font = `700 ${fontSize}px Segoe UI, Candara, sans-serif`;
      while (ctx.measureText(label).width > maxWidth && fontSize > 8) {
        fontSize -= 1;
        ctx.font = `700 ${fontSize}px Segoe UI, Candara, sans-serif`;
      }
      ctx.fillText(label, x + w / 2, y + h / 2 + (options.badge ? 8 : 0), maxWidth);
    }
  }

  function drawHiveCanvas(grid, bottomId, playerLookup) {
    const cell = 96;
    const gap = 2;
    const pad = 24;
    const header = 56;
    const footerGap = 10;
    const boardW = GRID_SIZE * cell + (GRID_SIZE - 1) * gap;
    const boardH = boardW;
    const canvas = document.createElement('canvas');
    canvas.width = pad * 2 + boardW;
    canvas.height = header + pad + boardH + footerGap + cell + pad;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#121417';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#e8ecf1';
    ctx.font = 'bold 28px Segoe UI, Candara, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const allianceTag =
      global.ROSModels && typeof ROSModels.getAllianceTag === 'function'
        ? ROSModels.getAllianceTag(ROSStorage.getState())
        : 'Alliance';
    ctx.fillText(`${allianceTag} — Plan de ruche`, canvas.width / 2, 38);

    for (let r = 0; r < GRID_SIZE; r += 1) {
      for (let c = 0; c < GRID_SIZE; c += 1) {
        const value = grid[r][c];
        const marshal = isMarshalCell(r, c);
        const x = pad + c * (cell + gap);
        const y = header + pad + r * (cell + gap);
        const bg = value || marshal ? colorForGridCell(r, c, value, playerLookup) : '#1e232b';
        let label = '';
        let badge = '';
        if (marshal) {
          badge = 'MARÉCHAL';
          const player = value && value !== FREE ? playerLookup(value) : null;
          label = player ? player.pseudo : '—';
        } else if (value === FREE) {
          label = 'FREE';
        } else if (value) {
          const player = playerLookup(value);
          label = player ? player.pseudo : '—';
        }
        fillLabeledCell(ctx, x, y, cell, cell, bg, label, {
          badge,
          fontSize: marshal ? 13 : 14,
          stroke: marshal ? '#f5f7fa' : '#3a424e',
          lineWidth: marshal ? 3 : 1,
        });
      }
    }

    // Case du bas — attribuable joueur (101ᵉ case)
    const bottomSize = cell;
    const bottomX = pad + (boardW - bottomSize) / 2;
    const bottomY = header + pad + boardH + footerGap;
    const bottomBg = bottomId ? colorForValue(bottomId, playerLookup) : '#1e232b';
    let bottomLabel = '';
    if (bottomId === FREE) bottomLabel = 'FREE';
    else if (bottomId) {
      const player = playerLookup(bottomId);
      bottomLabel = player ? player.pseudo : '—';
    }
    fillLabeledCell(ctx, bottomX, bottomY, bottomSize, bottomSize, bottomBg, bottomLabel);

    return canvas;
  }

  function exportPng() {
    const canvas = drawHiveCanvas(getState().grid, getBottomId(), getPlayerById);
    canvas.toBlob((blob) => {
      if (!blob) {
        AppUI.toast('Export PNG impossible.');
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      a.href = url;
      const tag =
        global.ROSModels && typeof ROSModels.getAllianceTag === 'function'
          ? ROSModels.getAllianceTag(ROSStorage.getState())
          : 'alliance';
      a.download = `warops-ruche-${tag}-${stamp}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      AppUI.toast('PNG téléchargé.');
    }, 'image/png');
  }

  function xmlEscape(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function exportExcel() {
    const grid = getState().grid;
    const bottomId = getBottomId();
    const rows = grid
      .map((row) => {
        const cells = row
          .map((value) => {
            const label = labelForValue(value) || '';
            return `<Cell><Data ss:Type="String">${xmlEscape(label)}</Data></Cell>`;
          })
          .join('');
        return `<Row>${cells}</Row>`;
      })
      .join('');

    const bottomLabel = labelForValue(bottomId) || '';
    const bottomRow = `<Row><Cell><Data ss:Type="String">Bas</Data></Cell><Cell><Data ss:Type="String">${xmlEscape(bottomLabel)}</Data></Cell></Row>`;

    const xml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Worksheet ss:Name="Ruche">
  <Table>${rows}${bottomRow}</Table>
 </Worksheet>
</Workbook>`;

    const blob = new Blob([xml], { type: 'application/vnd.ms-excel' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    a.href = url;
    const tag =
      global.ROSModels && typeof ROSModels.getAllianceTag === 'function'
        ? ROSModels.getAllianceTag(ROSStorage.getState())
        : 'alliance';
    a.download = `warops-ruche-${tag}-${stamp}.xls`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    AppUI.toast('Fichier Excel téléchargé.');
  }

  function init() {
    cacheDom();
    loadState();

    if (els.btnVerify) els.btnVerify.addEventListener('click', verifyHive);
    if (els.btnValidate) els.btnValidate.addEventListener('click', validateHive);
    if (els.btnExportPng) els.btnExportPng.addEventListener('click', exportPng);
    if (els.btnExportExcel) els.btnExportExcel.addEventListener('click', exportExcel);
    if (els.btnClear) els.btnClear.addEventListener('click', clearGrid);
    if (els.btnProposalOptimize) {
      els.btnProposalOptimize.addEventListener('click', regenerateProposal);
    }
    if (els.btnProposalValidate) {
      els.btnProposalValidate.addEventListener('click', validateProposal);
    }
    if (els.proposalMode) {
      els.proposalMode.addEventListener('change', syncOfficerMovesOptionVisibility);
    }
    if (els.allowOfficerMoves) {
      // Décoché par défaut — le responsable doit cocher explicitement
      els.allowOfficerMoves.checked = false;
    }
    syncOfficerMovesOptionVisibility();

    [els.colorMarshal, els.colorR4, els.colorFree].forEach((input) => {
      if (input) input.addEventListener('change', onColorChange);
    });

    if (els.root) {
      els.root.addEventListener('change', onCellChange);
      els.root.addEventListener('click', onRootClick);
    }
    bindProposalDnD();

    ensureProposal(false);
    render();
  }

  global.RucheModule = {
    init,
    render,
    renderSettings,
    hydrateFromStorage,
    migratePlayerIdentity,
    STORAGE_KEY,
    GRID_SIZE,
    GRID_SLOTS,
    TOTAL_CASES,
    PLAYER_SLOTS,
    MARSHAL_ROW,
    MARSHAL_COL,
    FREE,
    getCell,
    setCell,
    clearCell,
    swapCells,
    getMarshalId,
    setMarshal,
    getBottomId,
    setBottom,
    isMarshalCell,
    analyzeGrid,
    buildOptimizedProposal,
    computeProposalStats,
    ensureProposal,
  };
})(window);
