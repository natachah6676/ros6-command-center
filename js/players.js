/**
 * Gestion des membres + fiche joueur
 */
(function (global) {
  const els = {};
  let detailPlayerId = null;
  let detailAllowEdit = true;

  function cacheDom() {
    els.list = document.getElementById('playersList');
    els.empty = document.getElementById('playersEmpty');
    els.search = document.getElementById('playerSearch');
    els.filterStatus = document.getElementById('filterStatus');
    els.filterRole = document.getElementById('filterRoleAdmin');
    els.filterPower = document.getElementById('filterPowerAdmin');
    els.filterDiscret = document.getElementById('filterDiscretAdmin');
    els.powerCounter = document.getElementById('playersPowerCounter');
    els.btnAdd = document.getElementById('btnAddPlayer');
    els.modal = document.getElementById('playerModal');
    els.form = document.getElementById('playerForm');
    els.modalTitle = document.getElementById('playerModalTitle');
    els.playerId = document.getElementById('playerId');
    els.pseudo = document.getElementById('playerPseudo');
    els.role = document.getElementById('playerRole');
    els.status = document.getElementById('playerStatus');
    els.statusField = document.getElementById('playerStatusField');
    els.absent = document.getElementById('playerAbsent');
    els.absentField = document.getElementById('playerAbsentField');
    els.discret = document.getElementById('playerDiscret');
    els.discretField = document.getElementById('playerDiscretField');
    els.inactive = document.getElementById('playerInactive');
    els.inactiveField = document.getElementById('playerInactiveField');
    els.heroPower = document.getElementById('playerHeroPower');
    els.preferredVolant = document.getElementById('playerPreferredVolant');
    els.overlay = document.getElementById('playerDetailOverlay');
    els.drawer = document.getElementById('playerDetailDrawer');
    els.detailTitle = document.getElementById('playerDetailTitle');
    els.detailSubtitle = document.getElementById('playerDetailSubtitle');
    els.detailBody = document.getElementById('playerDetailBody');
    els.detailClose = document.getElementById('playerDetailClose');
    els.detailCloseBtn = document.getElementById('playerDetailCloseBtn');
    els.detailEdit = document.getElementById('playerDetailEdit');
  }

  function hasHeroPowerTier(player) {
    return Boolean(player?.heroPowerTierId);
  }

  /** Filtre puissance héros : Toutes + Non renseignée + tranches. */
  function fillHeroPowerFilterOptions() {
    if (!els.filterPower) return;
    const current = els.filterPower.value || '';
    const opts = [
      '<option value="">Toutes les puissances</option>',
      '<option value="missing">Non renseignée</option>',
    ];
    const tiers = ROSModels.getPowerTiers(ROSStorage.getState());
    tiers.forEach((tier) => {
      opts.push(
        `<option value="${ROSUI.escapeHtml(tier.id)}">${ROSUI.escapeHtml(tier.label)}</option>`
      );
    });
    els.filterPower.innerHTML = opts.join('');
    const keep =
      current === '' ||
      current === 'missing' ||
      Boolean(ROSModels.getPowerTierById(ROSStorage.getState(), current));
    els.filterPower.value = keep ? current : '';
  }

  function filteredPlayers() {
    const search = (els.search.value || '').trim().toLowerCase();
    const status = els.filterStatus.value;
    const role = els.filterRole?.value || '';
    const powerFilter = els.filterPower?.value || '';
    const discretFilter = els.filterDiscret?.value || '';

    return ROSStorage.getState()
      .players.filter((player) => {
        if (status === 'Absent') {
          if (!(player.status === 'Actif' && player.absent)) return false;
        } else if (status) {
          if (player.status !== status) return false;
        }
        if (role && player.role !== role) return false;
        if (search && !player.pseudo.toLowerCase().includes(search)) return false;
        if (powerFilter === 'missing') {
          if (hasHeroPowerTier(player)) return false;
        } else if (powerFilter) {
          if (player.heroPowerTierId !== powerFilter) return false;
        }
        if (discretFilter === 'discret') {
          if (!player.discret || player.status !== 'Actif') return false;
        } else if (discretFilter === 'discret_due') {
          if (!ROSModels.isDiscretContactOverdue(player)) return false;
        }
        return true;
      })
      .sort((a, b) => a.pseudo.localeCompare(b.pseudo, 'fr', { sensitivity: 'base' }));
  }

  function renderPowerCounter() {
    if (!els.powerCounter) return;
    const actives = ROSStorage.getState().players.filter((p) => p.status === 'Actif');
    const filled = actives.filter((p) => hasHeroPowerTier(p)).length;
    els.powerCounter.textContent = `Puissances renseignées : ${filled} / ${actives.length} joueurs actifs`;
  }

  function getActiveVsWeek(state = ROSStorage.getState()) {
    if (!state?.currentWeekId) return null;
    const week = (state.weeks || []).find((w) => w.id === state.currentWeekId);
    if (!week || week.archived) return null;
    return week;
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

  function fillHeroPowerSelect(selectedId = '') {
    if (!els.heroPower) return;
    const tiers = ROSModels.getPowerTiers(ROSStorage.getState());
    els.heroPower.innerHTML = ROSModels.buildPowerTierSelectOptions(tiers, selectedId || '');
  }

  function openCreateModal() {
    els.modalTitle.textContent = 'Ajouter un joueur';
    els.playerId.value = '';
    els.pseudo.value = '';
    els.role.value = 'Membre';
    els.status.value = 'Actif';
    els.absent.checked = false;
    if (els.discret) els.discret.checked = false;
    if (els.inactive) els.inactive.checked = false;
    fillHeroPowerSelect('');
    if (els.preferredVolant) els.preferredVolant.checked = false;
    els.statusField.hidden = true;
    els.absentField.hidden = false;
    if (els.discretField) els.discretField.hidden = false;
    if (els.inactiveField) els.inactiveField.hidden = false;
    els.modal.showModal();
    els.pseudo.focus();
  }

  function openEditModal(playerId) {
    const player = ROSStorage.getPlayerById(playerId);
    if (!player) return;
    els.modalTitle.textContent = 'Modifier un joueur';
    els.playerId.value = player.id;
    els.pseudo.value = player.pseudo;
    els.role.value = player.role;
    els.status.value = player.status;
    els.absent.checked = Boolean(player.absent);
    if (els.discret) els.discret.checked = Boolean(player.discret);
    if (els.inactive) els.inactive.checked = Boolean(player.inactive);
    fillHeroPowerSelect(player.heroPowerTierId || '');
    if (els.preferredVolant) els.preferredVolant.checked = Boolean(player.preferredVolant);
    els.statusField.hidden = false;
    els.absentField.hidden = player.status === 'Parti';
    if (els.discretField) els.discretField.hidden = player.status === 'Parti';
    if (els.inactiveField) els.inactiveField.hidden = player.status === 'Parti';
    els.modal.showModal();
    els.pseudo.focus();
  }

  function closeModal() {
    if (els.modal.open) els.modal.close();
  }

  function closeDetail() {
    detailPlayerId = null;
    els.drawer.classList.remove('is-open');
    els.drawer.setAttribute('aria-hidden', 'true');
    els.overlay.hidden = true;
  }

  function renderHistoryTable(playerId) {
    const state = ROSStorage.getState();
    const week = ROSModels.getCurrentWeekFromState(state);
    if (!week) {
      return '<p class="empty-state">Aucune semaine VS active — pas d’historique conservé.</p>';
    }

    const summary = ROSModels.getWeekScoreSummary(week, playerId);
    const note = ROSUI.getPlayerWeekNote(state, playerId, week.id);
    const points = summary.hasRecord ? String(summary.total) : '—';
    const color = summary.hasRecord
      ? `<span class="score-pill ${summary.color}">${ROSUI.escapeHtml(summary.colorLabel)}</span>`
      : '—';
    const commentCell = detailAllowEdit
      ? `<input class="input input-sm" data-note-field="comment" data-week="${week.id}" value="${ROSUI.escapeHtml(note.comment)}" placeholder="Commentaire…" />`
      : ROSUI.escapeHtml(note.comment || '—');

    return `
      <div class="table-wrap">
        <table class="fiche-table">
          <thead>
            <tr>
              <th>Semaine active</th>
              <th>Points</th>
              <th>Couleur</th>
              <th>Commentaires</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>${ROSUI.escapeHtml(week.label)}</td>
              <td>${points}</td>
              <td>${color}</td>
              <td>${commentCell}</td>
            </tr>
          </tbody>
        </table>
      </div>
    `;
  }

  function openDetail(playerId, options = {}) {
    const player = ROSStorage.getPlayerById(playerId);
    if (!player) return;

    detailPlayerId = playerId;
    detailAllowEdit = options.allowEdit !== false;

    els.detailTitle.textContent = player.pseudo;
    els.detailSubtitle.textContent = `${player.role} · ${player.status}${player.absent ? ' · Absent' : ''}${player.discret ? ' · Discret' : ''}${player.inactive ? ' · Inactif' : ''}`;
    els.detailEdit.hidden = !detailAllowEdit;

    const currentWeek = ROSModels.getCurrentWeekFromState(ROSStorage.getState());
    const summary = ROSModels.getWeekScoreSummary(currentWeek, playerId);
    const absentBadge = player.absent ? '<span class="badge badge-absent">Absent</span>' : '';
    const inactiveBadge = player.inactive ? '<span class="badge badge-status-parti">Inactif</span>' : '';
    const vsNote = player.absent
      ? 'Hors VS (absent) — non compté dans les seuils / compteurs.'
      : summary.hasRecord
        ? `${summary.daysUnderObjective} j sous objectif · ${summary.objectivesMet} j score fait · ${ROSUI.escapeHtml(summary.colorLabel)}`
        : 'aucune donnée VS';

    const trainLabel =
      global.TrainModule && typeof TrainModule.formatPlayerCounters === 'function'
        ? TrainModule.formatPlayerCounters(player)
        : '';

    els.detailBody.innerHTML = `
      <div class="player-meta">
        <span class="badge badge-role">${ROSUI.escapeHtml(player.role)}</span>
        <span class="badge badge-status-${player.status.toLowerCase()}">${ROSUI.escapeHtml(player.status)}</span>
        ${absentBadge}
        ${inactiveBadge}
      </div>

      <div class="detail-item">
        <strong>Pseudo</strong>
        <div>${ROSUI.escapeHtml(player.pseudo)}</div>
      </div>
      <div class="detail-item">
        <strong>Rôle</strong>
        <div>${ROSUI.escapeHtml(player.role)}</div>
      </div>
      <div class="detail-item">
        <strong>Statut</strong>
        <div>${ROSUI.escapeHtml(player.status)}${player.absent ? ' · Absent' : ''}${
          player.discret ? ' · Discret' : ''
        }</div>
      </div>
      <div class="detail-item">
        <strong>Puissance héros</strong>
        <div>${ROSUI.escapeHtml(ROSModels.getPlayerPowerLabel(player, ROSStorage.getState()))}</div>
      </div>
      <div class="detail-item">
        <strong>Volant préféré</strong>
        <div>${player.preferredVolant ? 'Oui' : 'Non'}</div>
      </div>
      ${
        trainLabel
          ? `<div class="detail-item">
              <strong>Train (mois en cours)</strong>
              <div>${ROSUI.escapeHtml(trainLabel)}</div>
            </div>`
          : ''
      }
      ${
        globalThis.PlayerStats && typeof PlayerStats.renderStatsHtml === 'function'
          ? PlayerStats.renderStatsHtml(playerId)
          : ''
      }

      <div>
        <strong class="section-label">Semaine VS active</strong>
        <p class="panel-subtitle" style="margin:0.35rem 0 0.7rem">
          ${vsNote} · aucun historique VS détaillé conservé après clôture
        </p>
        ${renderHistoryTable(playerId)}
      </div>
    `;

    els.overlay.hidden = false;
    els.drawer.classList.add('is-open');
    els.drawer.setAttribute('aria-hidden', 'false');
  }

  function saveWeekNote(weekId, field, value) {
    if (!detailPlayerId || !detailAllowEdit) return;
    ROSStorage.update(
      (state) => {
        if (!state.playerWeekNotes) state.playerWeekNotes = {};
        if (!state.playerWeekNotes[detailPlayerId]) state.playerWeekNotes[detailPlayerId] = {};
        const current = state.playerWeekNotes[detailPlayerId][weekId] || {
          comment: '',
          conducteur: '',
          vip: '',
          saison: '',
        };
        current[field] = String(value || '').trim();
        state.playerWeekNotes[detailPlayerId][weekId] = current;
        return state;
      },
      { silent: true }
    );
  }

  async function savePlayer(event) {
    event.preventDefault();
    const pseudo = els.pseudo.value.trim();
    if (!pseudo) {
      AppUI.toast('Le pseudo est obligatoire.');
      return;
    }

    const id = els.playerId.value;
    const role = els.role.value;
    const status = els.statusField.hidden ? 'Actif' : els.status.value;
    const absent = status === 'Parti' ? false : Boolean(els.absent.checked);
    const discret = status === 'Parti' ? false : Boolean(els.discret?.checked);
    const inactive = status === 'Parti' ? false : Boolean(els.inactive?.checked);
    const heroPowerTierId = (els.heroPower?.value || '').trim() || null;
    const preferredVolant = Boolean(els.preferredVolant?.checked);

    if (heroPowerTierId && !ROSModels.getPowerTierById(ROSStorage.getState(), heroPowerTierId)) {
      AppUI.toast('Tranche de puissance invalide. Rechargez la fiche.');
      return;
    }

    if (id) {
      const existing = ROSStorage.getPlayerById(id);
      if (existing && existing.status === 'Actif' && status === 'Parti') {
        const ok = await AppUI.confirm({
          title: 'Passer en « Parti »',
          message: `Confirmer le départ de « ${existing.pseudo} » ?`,
          confirmLabel: 'Passer en Parti',
        });
        if (!ok) return;
      }
    }

    let duplicateBlocked = false;
    let renamedFrom = null;

    ROSStorage.update((state) => {
      if (id) {
        const player = state.players.find((p) => p.id === id);
        if (!player) return state;

        const duplicate = state.players.some(
          (p) =>
            p.id !== id &&
            p.status === 'Actif' &&
            p.pseudo.toLowerCase() === pseudo.toLowerCase()
        );
        if (duplicate) {
          duplicateBlocked = true;
          return state;
        }

        const previousStatus = player.status;
        const previousPseudo = player.pseudo;
        // Renommage sur place : même ID, historique intact (scores / notes / modules)
        player.pseudo = pseudo;
        player.role = role;
        player.status = status;
        player.absent = absent;
        player.discret = discret;
        player.inactive = inactive;
        player.heroPowerTierId = heroPowerTierId;
        if (!heroPowerTierId && global.ROSSync?.markPlayerFieldCleared) {
          ROSSync.markPlayerFieldCleared(player, 'heroPowerTierId');
        } else if (heroPowerTierId && global.ROSSync?.clearPlayerFieldCleared) {
          ROSSync.clearPlayerFieldCleared(player, 'heroPowerTierId');
        }
        player.preferredVolant = preferredVolant;
        if (previousStatus === 'Actif' && status === 'Parti') {
          player.leftAt = new Date().toISOString();
          player.absent = false;
          player.discret = false;
          player.inactive = false;
        }
        if (previousStatus === 'Parti' && status === 'Actif') {
          player.leftAt = null;
        }
        if (previousPseudo !== pseudo) {
          renamedFrom = previousPseudo;
          if (globalThis.ROSPlayerIdentity) {
            ROSPlayerIdentity.migrateMainState(state, {
              explicitPseudo: previousPseudo,
              explicitPlayerId: id,
            });
          }
        }
      } else {
        const duplicate = state.players.some(
          (p) => p.pseudo.toLowerCase() === pseudo.toLowerCase() && p.status === 'Actif'
        );
        if (duplicate) {
          duplicateBlocked = true;
          return state;
        }
        const created = ROSModels.createPlayer({
          pseudo,
          role,
          status: 'Actif',
          absent,
          discret,
          inactive,
          heroPowerTierId,
          preferredVolant,
        });
        state.players.push(created);
        const week = state.weeks.find((w) => w.id === state.currentWeekId);
        if (week && !absent) week.scores[created.id] = ROSModels.createEmptyScore();
      }
      return state;
    });

    if (duplicateBlocked) {
      AppUI.toast('Un joueur actif porte déjà ce pseudo.');
      return;
    }

    if (renamedFrom && globalThis.ROSPlayerIdentity) {
      ROSPlayerIdentity.migrateAllStoresAfterRename(renamedFrom, id);
    }

    closeModal();
    AppUI.toast(
      renamedFrom
        ? `Pseudo mis à jour (« ${renamedFrom} » → « ${pseudo} »). Historique conservé.`
        : id
          ? 'Joueur mis à jour.'
          : 'Joueur ajouté.'
    );
    if (detailPlayerId === id) openDetail(id, { allowEdit: detailAllowEdit });
    if (global.SuiviModule && typeof SuiviModule.render === 'function') SuiviModule.render();
  }

  async function markAsLeft(playerId) {
    const player = ROSStorage.getPlayerById(playerId);
    if (!player || player.status !== 'Actif') return;

    const ok = await AppUI.confirm({
      title: 'Passer en « Parti »',
      message: `Confirmer le départ de « ${player.pseudo} » ?`,
      confirmLabel: 'Passer en Parti',
    });
    if (!ok) return;

    ROSStorage.update((state) => {
      const target = state.players.find((p) => p.id === playerId);
      if (target) {
        target.status = 'Parti';
        target.leftAt = new Date().toISOString();
        target.absent = false;
        target.discret = false;
      }
      return state;
    });

    AppUI.toast(`${player.pseudo} est passé en « Parti ». Historique conservé.`);
  }

  function reactivate(playerId) {
    const player = ROSStorage.getPlayerById(playerId);
    if (!player || player.status !== 'Parti') return;

    ROSStorage.update((state) => {
      const target = state.players.find((p) => p.id === playerId);
      if (target) {
        target.status = 'Actif';
        target.leftAt = null;
      }
      return state;
    });

    AppUI.toast(`${player.pseudo} a été réactivé.`);
  }

  function setAbsent(playerId, absent) {
    ROSStorage.update((state) => {
      const target = state.players.find((p) => p.id === playerId);
      if (!target || target.status !== 'Actif') return state;
      target.absent = Boolean(absent);
      const week =
        state.currentWeekId &&
        (state.weeks || []).find((w) => w.id === state.currentWeekId && !w.archived);
      if (week && week.scores) {
        if (absent) {
          delete week.scores[playerId];
        } else if (!week.scores[playerId]) {
          week.scores[playerId] = ROSModels.createEmptyScore();
        }
      }
      return state;
    });
    if (global.VSModule && typeof VSModule.render === 'function') VSModule.render();
    if (global.SuiviModule && typeof SuiviModule.render === 'function') SuiviModule.render();
    AppUI.toast(absent ? 'Joueur marqué Absent (hors VS).' : 'Joueur de nouveau présent dans le VS.');
  }

  function canEditDiscretContact() {
    return Boolean(
      global.ROSProfiles &&
        typeof ROSProfiles.isActiveR4OrR5 === 'function' &&
        ROSProfiles.isActiveR4OrR5()
    );
  }

  function markDiscretContact(playerId) {
    if (!canEditDiscretContact()) {
      AppUI.toast('Seul un R4 ou R5 peut noter un contact Discret.');
      return;
    }
    const actor = actorStamp();
    ROSStorage.update((state) => {
      const target = state.players.find((p) => p.id === playerId);
      if (!target || !target.discret) return state;
      ROSModels.pushDiscretContact(target, {
        text: 'Contact pris',
        authorLabel: actor.actorLabel || '',
        authorUserId: actor.actorUserId || '',
      });
      return state;
    });
    AppUI.toast('Contact Discret enregistré.');
    if (global.SuiviModule && typeof SuiviModule.renderHistory === 'function') {
      SuiviModule.renderHistory();
    }
    render();
  }

  function setDiscret(playerId, discret) {
    ROSStorage.update((state) => {
      const target = state.players.find((p) => p.id === playerId);
      if (!target || target.status !== 'Actif') return state;
      target.discret = Boolean(discret);
      return state;
    });
    if (global.SuiviModule && typeof SuiviModule.render === 'function') SuiviModule.render();
    AppUI.toast(
      discret
        ? 'Joueur marqué Discret — contact dans Liste des membres.'
        : 'Marqueur Discret retiré.'
    );
  }

  function setHeroPowerTier(playerId, tierId) {
    const nextId = (tierId || '').trim() || null;
    if (nextId && !ROSModels.getPowerTierById(ROSStorage.getState(), nextId)) {
      AppUI.toast('Tranche de puissance invalide.');
      render();
      return;
    }

    ROSStorage.update((state) => {
      const target = state.players.find((p) => p.id === playerId);
      if (!target) return state;
      target.heroPowerTierId = nextId;
      if (!nextId && global.ROSSync?.markPlayerFieldCleared) {
        ROSSync.markPlayerFieldCleared(target, 'heroPowerTierId');
      } else if (nextId && global.ROSSync?.clearPlayerFieldCleared) {
        ROSSync.clearPlayerFieldCleared(target, 'heroPowerTierId');
      }
      return state;
    });
    AppUI.toast(nextId ? 'Puissance héros enregistrée.' : 'Puissance héros : Non renseignée.');
  }

  function renderCard(player) {
    const state = ROSStorage.getState();
    const powerMissing = !hasHeroPowerTier(player);
    const absentBadge = player.absent ? '<span class="badge badge-absent">Absent</span>' : '';
    const discretOverdue = ROSModels.isDiscretContactOverdue(player);
    const lastDiscretAt = ROSModels.getLastDiscretContactAt(player);
    const lastDiscretLabel = lastDiscretAt
      ? ROSModels.formatCoachingDateTime(lastDiscretAt) || lastDiscretAt
      : '';
    const discretBadge = player.discret
      ? `<span class="badge badge-role${discretOverdue ? ' badge-discret-due' : ''}">Discret${
          discretOverdue ? ' · à contacter' : ''
        }</span>`
      : '';
    const discretContactMeta =
      player.discret && player.status === 'Actif'
        ? `<span class="member-discret-contact${discretOverdue ? ' is-due' : ''}">${
            lastDiscretLabel
              ? `Dernier contact : ${ROSUI.escapeHtml(lastDiscretLabel)}`
              : 'Pas encore contacté'
          }</span>`
        : '';
    const powerMissingBadge = powerMissing
      ? '<span class="badge badge-power-missing">Puissance non renseignée</span>'
      : '';
    const absentToggle =
      player.status === 'Actif'
        ? `
          <label class="absent-toggle" title="Absent du VS">
            <input type="checkbox" data-action="absent" data-id="${player.id}" ${player.absent ? 'checked' : ''} />
            <span>Absent</span>
          </label>
        `
        : '';
    const discretToggle =
      player.status === 'Actif'
        ? `
          <label class="absent-toggle" title="Discret mais fort — prise de nouvelles dans la liste">
            <input type="checkbox" data-action="discret" data-id="${player.id}" ${
              player.discret ? 'checked' : ''
            } />
            <span>Discret</span>
          </label>
        `
        : '';
    const discretContactBtn =
      player.status === 'Actif' && player.discret && canEditDiscretContact()
        ? `<button type="button" class="btn btn-primary btn-sm" data-action="discret-contact" data-id="${player.id}">Contact pris</button>`
        : '';

    const vsUnderStats = ROSModels.getPlayerVsUnderStats(state, player.id);
    const vsUnderLabel = ROSModels.formatVsUnderCounterLabel(vsUnderStats);
    const tempeteCount =
      globalThis.PlayerStats && typeof PlayerStats.computePlayerStats === 'function'
        ? PlayerStats.computePlayerStats(player.id).storms || 0
        : 0;
    const memberCounters = `
      <div class="member-counters" aria-label="Compteurs membre">
        <span class="member-counter">${ROSUI.escapeHtml(vsUnderLabel)}</span>
        <span class="member-counter">Inscrit Tempete : ${tempeteCount}</span>
      </div>
    `;

    const powerSelect =
      player.status === 'Actif'
        ? `
          <label class="member-power-field" title="Puissance héros">
            <span class="member-power-label">Puissance héros</span>
            <select
              class="input member-power-select${powerMissing ? ' is-missing' : ''}"
              data-action="hero-power"
              data-id="${player.id}"
              aria-label="Puissance héros de ${ROSUI.escapeHtml(player.pseudo)}"
            >
              ${ROSModels.buildPowerTierSelectOptions(
                ROSModels.getPowerTiers(state),
                player.heroPowerTierId || ''
              )}
            </select>
          </label>
        `
        : `
          <div class="member-power-field member-power-readonly">
            <span class="member-power-label">Puissance héros</span>
            <span class="member-power-value${powerMissing ? ' is-missing' : ''}">${ROSUI.escapeHtml(
              ROSModels.getPlayerPowerLabel(player, state)
            )}</span>
          </div>
        `;

    const actions =
      player.status === 'Actif'
        ? `
          ${absentToggle}
          ${discretToggle}
          ${discretContactBtn}
          <button type="button" class="btn btn-ghost btn-sm" data-action="edit" data-id="${player.id}">Modifier</button>
          <button type="button" class="btn btn-danger btn-sm" data-action="leave" data-id="${player.id}">Passer en Parti</button>
        `
        : `
          <button type="button" class="btn btn-ghost btn-sm" data-action="edit" data-id="${player.id}">Modifier</button>
          <button type="button" class="btn btn-primary btn-sm" data-action="reactivate" data-id="${player.id}">Réactiver</button>
        `;

    return `
      <article class="member-row${powerMissing ? ' member-row--power-missing' : ''}${
        discretOverdue ? ' member-row--discret-due' : ''
      }" data-open-player="${player.id}">
        <div class="member-row-main">
          <h3 class="player-name">${ROSUI.escapeHtml(player.pseudo)}</h3>
          <div class="player-meta">
            <span class="badge badge-role">${ROSUI.escapeHtml(player.role)}</span>
            <span class="badge badge-status-${player.status.toLowerCase()}">${ROSUI.escapeHtml(player.status)}</span>
            ${absentBadge}
            ${discretBadge}
            ${powerMissingBadge}
          </div>
          ${discretContactMeta}
        </div>
        ${memberCounters}
        ${powerSelect}
        <div class="player-actions">${actions}</div>
      </article>
    `;
  }

  function render() {
    const players = filteredPlayers();
    els.list.innerHTML = players.map(renderCard).join('');
    els.empty.classList.toggle('hidden', players.length > 0);
    renderPowerCounter();

    if (detailPlayerId && els.drawer.classList.contains('is-open')) {
      openDetail(detailPlayerId, { allowEdit: detailAllowEdit });
    }
  }

  function onListClick(event) {
    if (
      event.target.closest('.absent-toggle') ||
      event.target.closest('.member-power-field')
    ) {
      event.stopPropagation();
      return;
    }

    const actionBtn = event.target.closest('[data-action]');
    if (actionBtn) {
      event.stopPropagation();
      const { action, id } = actionBtn.dataset;
      if (action === 'edit') openEditModal(id);
      if (action === 'leave') markAsLeft(id);
      if (action === 'reactivate') reactivate(id);
      if (action === 'discret-contact') markDiscretContact(id);
      return;
    }

    const row = event.target.closest('[data-open-player]');
    if (row) openDetail(row.dataset.openPlayer, { allowEdit: true });
  }

  function onListChange(event) {
    const absentInput = event.target.closest('input[data-action="absent"]');
    if (absentInput) {
      setAbsent(absentInput.dataset.id, absentInput.checked);
      return;
    }
    const discretInput = event.target.closest('input[data-action="discret"]');
    if (discretInput) {
      setDiscret(discretInput.dataset.id, discretInput.checked);
      return;
    }

    const powerSelect = event.target.closest('select[data-action="hero-power"]');
    if (powerSelect) {
      setHeroPowerTier(powerSelect.dataset.id, powerSelect.value);
    }
  }

  function onDetailChange(event) {
    const input = event.target.closest('[data-note-field]');
    if (!input) return;
    saveWeekNote(input.dataset.week, input.dataset.noteField, input.value);
  }

  function init() {
    cacheDom();
    fillHeroPowerFilterOptions();
    els.btnAdd.addEventListener('click', openCreateModal);
    els.form.addEventListener('submit', savePlayer);
    els.list.addEventListener('click', onListClick);
    els.list.addEventListener('change', onListChange);
    els.search.addEventListener('input', render);
    els.filterStatus.addEventListener('change', render);
    els.filterRole.addEventListener('change', render);
    if (els.filterPower) els.filterPower.addEventListener('change', render);
    if (els.filterDiscret) els.filterDiscret.addEventListener('change', render);

    els.modal.querySelectorAll('[data-close-modal]').forEach((btn) => {
      btn.addEventListener('click', closeModal);
    });

    els.detailClose.addEventListener('click', closeDetail);
    els.detailCloseBtn.addEventListener('click', closeDetail);
    els.overlay.addEventListener('click', closeDetail);
    els.detailEdit.addEventListener('click', () => {
      if (detailPlayerId && detailAllowEdit) openEditModal(detailPlayerId);
    });
    els.detailBody.addEventListener('change', onDetailChange);

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && els.drawer.classList.contains('is-open')) {
        closeDetail();
      }
    });

    els.filterStatus.value = 'Actif';
    els.status.addEventListener('change', () => {
      els.absentField.hidden = els.status.value === 'Parti';
      if (els.discretField) els.discretField.hidden = els.status.value === 'Parti';
      if (els.inactiveField) els.inactiveField.hidden = els.status.value === 'Parti';
      if (els.status.value === 'Parti') {
        els.absent.checked = false;
        if (els.discret) els.discret.checked = false;
        if (els.inactive) els.inactive.checked = false;
      }
    });
  }

  global.PlayersModule = {
    init,
    render,
    openCreateModal,
    openEditModal,
    openDetail,
    closeDetail,
  };
})(window);
