/**
 * Gestion des membres — suivi des joueurs (VS / puissance héros / aide manuelle).
 * R4+R5 peuvent modifier le suivi. Seuils configurables en Paramètres (R5).
 */
(function (global) {
  const els = {};
  let selectedPlayerId = null;
  let showDone = false;

  function cacheDom() {
    els.root = document.getElementById('panel-suivi');
    els.list = document.getElementById('suiviList');
    els.empty = document.getElementById('suiviEmpty');
    els.search = document.getElementById('suiviSearch');
    els.filterStatus = document.getElementById('suiviFilterStatus');
    els.filterReason = document.getElementById('suiviFilterReason');
    els.showDone = document.getElementById('suiviShowDone');
    els.filterAssignee = document.getElementById('suiviFilterAssignee');
    els.btnCopyList = document.getElementById('btnSuiviCopyList');
    els.counter = document.getElementById('suiviCounter');
    els.btnAdd = document.getElementById('btnSuiviAdd');
    els.addSelect = document.getElementById('suiviAddPlayer');
    els.addWrap = document.getElementById('suiviAddWrap');
    els.detail = document.getElementById('suiviDetail');
    els.detailEmpty = document.getElementById('suiviDetailEmpty');
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function getAssignableOfficers(state) {
    const byId = new Map();
    (state.players || []).forEach((p) => {
      if (!p || p.status !== 'Actif') return;
      if (p.role === 'R4' || p.role === 'R5') byId.set(p.id, p);
    });
    // Comptes Accès (Paramètres) : un R4 lié à un joueur « Membre » doit aussi apparaître.
    if (global.ROSProfiles && typeof ROSProfiles.listProfiles === 'function') {
      ROSProfiles.listProfiles().forEach((prof) => {
        if (!prof || prof.status !== 'Actif') return;
        if (prof.role !== 'R4' && prof.role !== 'R5') return;
        if (!prof.playerId) return;
        const player = (state.players || []).find((p) => p && p.id === prof.playerId);
        if (!player || player.status !== 'Actif') return;
        const prev = byId.get(player.id);
        const role =
          prev?.role === 'R5' || player.role === 'R5' || prof.role === 'R5' ? 'R5' : 'R4';
        byId.set(player.id, { ...player, role });
      });
    }
    return Array.from(byId.values()).sort((a, b) => {
      if (a.role !== b.role) return a.role === 'R5' ? -1 : 1;
      return a.pseudo.localeCompare(b.pseudo, 'fr', { sensitivity: 'base' });
    });
  }

  function fillAssigneeFilter(state) {
    if (!els.filterAssignee) return;
    const previous = els.filterAssignee.value || '';
    const officers = getAssignableOfficers(state);
    els.filterAssignee.innerHTML =
      `<option value="">Tous les R4</option>` +
      `<option value="unassigned">Non assigné</option>` +
      officers
        .map(
          (p) =>
            `<option value="${escapeHtml(p.id)}">${escapeHtml(p.pseudo)} (${escapeHtml(
              p.role
            )})</option>`
        )
        .join('');
    if (
      previous === 'unassigned' ||
      previous === '' ||
      officers.some((p) => p.id === previous)
    ) {
      els.filterAssignee.value = previous;
    }
  }

  function assigneeLabelFor(follow) {
    if (!follow?.assigneePlayerId && !follow?.assigneeLabel) return '';
    return follow.assigneeLabel || 'R4';
  }

  function canEditFollowUp() {
    return Boolean(
      global.ROSProfiles &&
        typeof ROSProfiles.isActiveR4OrR5 === 'function' &&
        ROSProfiles.isActiveR4OrR5()
    );
  }

  function viewerIsR5() {
    return Boolean(
      global.ROSProfiles && typeof ROSProfiles.isActiveR5 === 'function' && ROSProfiles.isActiveR5()
    );
  }

  /** Joueur alliance lié au compte connecté (pour spécialités / assignation). */
  function viewerPlayerId() {
    const profile =
      global.ROSProfiles && typeof ROSProfiles.getCurrentProfile === 'function'
        ? ROSProfiles.getCurrentProfile()
        : null;
    return profile?.playerId || null;
  }

  function applySpecialistIfNeeded(row, reasons, state) {
    if (!row || row.assigneePlayerId) return false;
    const pick = ROSModels.pickFollowUpSpecialist(reasons, state);
    if (!pick) return false;
    row.assigneePlayerId = pick.assigneePlayerId;
    row.assigneeLabel = pick.assigneeLabel;
    row.assignedAt = new Date().toISOString();
    row.assignedByLabel = 'Référent motif';
    return true;
  }

  function updateScopeHint(state) {
    const hint = document.getElementById('suiviScopeHint');
    if (!hint) return;
    if (viewerIsR5()) {
      hint.classList.add('hidden');
      hint.textContent = '';
      return;
    }
    const keys = ROSModels.getFollowUpSpecialistKeysForPlayer(
      ROSModels.getFollowUpSettings(state),
      viewerPlayerId()
    );
    if (!keys.length) {
      hint.classList.add('hidden');
      hint.textContent = '';
      return;
    }
    const labels = ROSModels.FOLLOW_UP_SPECIALIST_KEYS.filter((k) => keys.includes(k.id)).map(
      (k) => k.label
    );
    hint.textContent = `Votre périmètre : ${labels.join(' · ')} (+ fiches qui vous sont assignées)`;
    hint.classList.remove('hidden');
  }

  function stampActor() {
    if (global.ROSProfiles && typeof ROSProfiles.stampActor === 'function') {
      return ROSProfiles.stampActor();
    }
    return { actorUserId: '', actorPlayerId: null, actorLabel: '' };
  }

  function ensureCase(state, playerId, seed = {}) {
    if (!state.playerFollowUps || typeof state.playerFollowUps !== 'object') {
      state.playerFollowUps = {};
    }
    if (!state.playerFollowUps[playerId]) {
      state.playerFollowUps[playerId] = ROSModels.createEmptyFollowUpCase(seed);
    } else {
      state.playerFollowUps[playerId] = ROSModels.normalizeFollowUpCase(
        state.playerFollowUps[playerId]
      );
    }
    return state.playerFollowUps[playerId];
  }

  function buildDisplayReasons(player, follow, state) {
    const detected = ROSModels.detectFollowUpReasons(player, state);
    return {
      vs: Boolean(detected.vs || follow?.reasons?.vs),
      hero: Boolean(detected.hero || follow?.reasons?.hero),
      praise: Boolean(detected.praise || follow?.reasons?.praise),
      discret: Boolean(detected.discret || follow?.reasons?.discret || player?.discret),
      manual: Boolean(follow?.manual || follow?.reasons?.manual || detected.manual),
    };
  }

  /** Applique les détections auto. Retourne true si l’état a changé. */
  function syncAutoReasons(state) {
    let changed = false;
    (state.players || []).forEach((player) => {
      if (!player || player.status !== 'Actif') return;
      if (player.absent && !player.discret) {
        // Hors suivi : l’absence se gère dans Liste des membres uniquement.
        const existing = state.playerFollowUps?.[player.id];
        if (
          existing &&
          existing.status !== 'done' &&
          !existing.manual &&
          !existing.reasons?.manual &&
          !existing.reasons?.discret
        ) {
          const onlyLegacyAbsent =
            !existing.reasons?.vs &&
            !existing.reasons?.hero &&
            !existing.reasons?.praise &&
            !existing.reasons?.manual &&
            !existing.reasons?.discret;
          if (onlyLegacyAbsent) {
            existing.status = 'done';
            existing.closedAt = new Date().toISOString();
            existing.updatedAt = new Date().toISOString();
            changed = true;
          }
        }
        return;
      }
      const detected = ROSModels.detectFollowUpReasons(player, state);
      const existing = state.playerFollowUps?.[player.id];
      const hasOpen = existing && existing.status !== 'done';
      const autoHit =
        detected.vs || detected.hero || detected.praise || detected.discret;
      if (!autoHit && !hasOpen && !detected.manual) return;

      // Suivi terminé : ne rouvre pas VS/héros. Discret : rouvre si la case liste est encore cochée.
      if (existing?.status === 'done') {
        if (!player.discret) return;
        existing.status = 'to_contact';
        existing.closedAt = null;
        existing.reasons = ROSModels.emptyFollowUpReasons({
          ...existing.reasons,
          discret: true,
        });
        existing.updatedAt = new Date().toISOString();
        applySpecialistIfNeeded(existing, existing.reasons, state);
        changed = true;
      }

      if (!existing || existing.status === 'done') {
        if (!existing) {
          const seedReasons = {
            vs: detected.vs,
            hero: detected.hero,
            praise: detected.praise,
            discret: detected.discret,
            manual: Boolean(detected.manual),
          };
          const row = ensureCase(state, player.id, {
            reasons: seedReasons,
            manual: Boolean(detected.manual),
          });
          applySpecialistIfNeeded(row, seedReasons, state);
          changed = true;
        }
        return;
      }

      const row = ensureCase(state, player.id);
      if (row.status === 'done') return;
      let rowChanged = false;
      ['vs', 'hero', 'praise', 'discret'].forEach((key) => {
        if (detected[key] && !row.reasons[key]) {
          row.reasons[key] = true;
          rowChanged = true;
        }
        // Retire les motifs auto qui ne sont plus vrais (évite les fiches « fantômes »).
        if (!detected[key] && row.reasons[key] && key !== 'manual') {
          row.reasons[key] = false;
          rowChanged = true;
        }
      });
      if (row.reasons?.absent) {
        row.reasons.absent = false;
        rowChanged = true;
      }
      if (row.manual && !row.reasons.manual) {
        row.reasons.manual = true;
        rowChanged = true;
      }
      const stillRelevant =
        row.reasons.vs ||
        row.reasons.hero ||
        row.reasons.praise ||
        row.reasons.discret ||
        row.manual ||
        row.reasons.manual;
      if (!stillRelevant && row.status !== 'done') {
        row.status = 'done';
        row.closedAt = new Date().toISOString();
        rowChanged = true;
      }
      if (stillRelevant && applySpecialistIfNeeded(row, { ...row.reasons, ...detected }, state)) {
        rowChanged = true;
      }
      if (rowChanged) {
        row.updatedAt = new Date().toISOString();
        changed = true;
      }
    });
    return changed;
  }

  function getActiveFollowUpRows(state) {
    const q = (els.search?.value || '').trim().toLowerCase();
    const statusFilter = els.filterStatus?.value || '';
    const reasonFilter = els.filterReason?.value || '';
    const assigneeFilter = els.filterAssignee?.value || '';

    return (state.players || [])
      .filter((p) => p && p.status === 'Actif')
      .map((player) => {
        const follow = state.playerFollowUps?.[player.id];
        if (!follow) return null;
        const displayReasons = buildDisplayReasons(player, follow, state);
        const isDone = follow.status === 'done';
        if (isDone && !showDone && statusFilter !== 'done') return null;
        if (
          !isDone &&
          !displayReasons.vs &&
          !displayReasons.hero &&
          !displayReasons.praise &&
          !displayReasons.discret &&
          !displayReasons.manual
        ) {
          return null;
        }
        if (statusFilter && follow.status !== statusFilter) return null;
        if (reasonFilter === 'vs' && !displayReasons.vs) return null;
        if (reasonFilter === 'hero' && !displayReasons.hero) return null;
        if (reasonFilter === 'praise' && !displayReasons.praise) return null;
        if (reasonFilter === 'discret' && !displayReasons.discret) return null;
        if (reasonFilter === 'manual' && !displayReasons.manual) return null;
        if (assigneeFilter === 'unassigned' && follow.assigneePlayerId) return null;
        if (
          assigneeFilter &&
          assigneeFilter !== 'unassigned' &&
          follow.assigneePlayerId !== assigneeFilter
        ) {
          return null;
        }
        if (q && !String(player.pseudo || '').toLowerCase().includes(q)) return null;
        return { player, follow, reasons: displayReasons };
      })
      .filter(Boolean)
      .filter((row) =>
        ROSModels.isFollowUpVisibleToViewer(row, state, viewerPlayerId(), viewerIsR5())
      )
      .sort((a, b) => {
        const order = { to_contact: 0, contacted: 1, in_progress: 2, done: 3 };
        const oa = order[a.follow.status] ?? 9;
        const ob = order[b.follow.status] ?? 9;
        if (oa !== ob) return oa - ob;
        return a.player.pseudo.localeCompare(b.player.pseudo, 'fr', { sensitivity: 'base' });
      });
  }

  function fillAddSelect(state, rows) {
    if (!els.addSelect) return;
    const activeIds = new Set(rows.filter((r) => r.follow.status !== 'done').map((r) => r.player.id));
    const options = (state.players || [])
      .filter((p) => p.status === 'Actif' && !p.absent && !activeIds.has(p.id))
      .sort((a, b) => a.pseudo.localeCompare(b.pseudo, 'fr', { sensitivity: 'base' }));
    els.addSelect.innerHTML =
      `<option value="">Ajouter un joueur à suivre…</option>` +
      options
        .map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.pseudo)}</option>`)
        .join('');
  }

  function renderList() {
    const probe = ROSStorage.getState();
    const draftFollowUps = JSON.parse(JSON.stringify(probe.playerFollowUps || {}));
    const muted = Boolean(ROSModels.getFollowUpSettings(probe).vsFollowUpMutedWeekId);
    const hasStaleVsStats =
      muted && probe.playerVsUnderStats && Object.keys(probe.playerVsUnderStats).length > 0;
    if (syncAutoReasons({ ...probe, playerFollowUps: draftFollowUps }) || hasStaleVsStats) {
      ROSStorage.update(
        (s) => {
          syncAutoReasons(s);
          // Tant que le mute reset est actif, aucun historique VS ne doit réapparaître.
          if (ROSModels.getFollowUpSettings(s).vsFollowUpMutedWeekId) {
            s.playerVsUnderStats = {};
          }
          return s;
        },
        { silent: true }
      );
    }
    const fresh = ROSStorage.getState();
    fillAssigneeFilter(fresh);
    updateScopeHint(fresh);
    const rows = getActiveFollowUpRows(fresh);
    fillAddSelect(fresh, rows);

    if (els.counter) {
      const toContact = rows.filter((r) => r.follow.status === 'to_contact').length;
      els.counter.textContent = `${rows.length} joueur(s) · ${toContact} à contacter`;
    }

    if (!rows.length) {
      if (els.list) els.list.innerHTML = '';
      if (els.empty) {
        els.empty.classList.remove('hidden');
        els.empty.textContent = showDone
          ? 'Aucun suivi terminé pour le moment.'
          : 'Aucun joueur à suivre pour le moment.';
      }
      renderDetail(null);
      return;
    }
    if (els.empty) els.empty.classList.add('hidden');

    if (els.list) {
      els.list.innerHTML = rows
        .map(({ player, follow, reasons }) => {
          const selected = player.id === selectedPlayerId ? ' is-selected' : '';
          const vsStats = ROSModels.getPlayerVsUnderStats(fresh, player.id);
          const vsSummary = ROSModels.summarizeVsUnderStats(vsStats);
          const showVsCounter = reasons.vs || vsSummary.underCount > 0;
          const showPraiseCounter = reasons.praise || vsSummary.praiseCount > 0;
          const vsCounter = showVsCounter
            ? ROSModels.formatVsUnderCounterLabel(vsStats)
            : '';
          const praiseCounter = showPraiseCounter
            ? ROSModels.formatVsPraiseCounterLabel(vsStats)
            : '';
          const assignee = assigneeLabelFor(follow);
          return `
            <button type="button" class="suivi-row${selected}" data-suivi-open="${escapeHtml(player.id)}">
              <span class="suivi-row-main">
                <strong>${escapeHtml(player.pseudo)}</strong>
                <span class="suivi-row-reasons">${escapeHtml(
                  ROSModels.formatFollowUpReasonsLabel(reasons)
                )}</span>
                ${
                  vsCounter
                    ? `<span class="suivi-row-vs-counter">${escapeHtml(vsCounter)}</span>`
                    : ''
                }
                ${
                  praiseCounter
                    ? `<span class="suivi-row-vs-counter">${escapeHtml(praiseCounter)}</span>`
                    : ''
                }
                ${
                  assignee
                    ? `<span class="suivi-row-assignee">Suivi par ${escapeHtml(assignee)}</span>`
                    : '<span class="suivi-row-assignee is-empty">Non assigné</span>'
                }
              </span>
              <span class="suivi-status suivi-status--${escapeHtml(follow.status)}">
                ${escapeHtml(ROSModels.getFollowUpStatusLabel(follow.status))}
              </span>
            </button>
          `;
        })
        .join('');
    }

    if (!selectedPlayerId || !rows.some((r) => r.player.id === selectedPlayerId)) {
      selectedPlayerId = rows[0].player.id;
    }
    renderDetail(selectedPlayerId);
  }

  function renderDetail(playerId) {
    if (!els.detail) return;
    const editable = canEditFollowUp();
    if (!playerId) {
      els.detail.classList.add('hidden');
      if (els.detailEmpty) els.detailEmpty.classList.remove('hidden');
      return;
    }
    const state = ROSStorage.getState();
    const player = state.players.find((p) => p.id === playerId);
    const follow = state.playerFollowUps?.[playerId];
    if (!player || !follow) {
      els.detail.classList.add('hidden');
      if (els.detailEmpty) els.detailEmpty.classList.remove('hidden');
      return;
    }
    if (els.detailEmpty) els.detailEmpty.classList.add('hidden');
    els.detail.classList.remove('hidden');

    const reasons = buildDisplayReasons(player, follow, state);
    const displayReasons = reasons;
    const week = ROSModels.getFollowUpReferenceWeek(state);
    const underDays = week ? ROSModels.countPlayerVsUnderDays(week, player.id) : 0;
    const settings = ROSModels.getFollowUpSettings(state);
    const heroLabel = ROSModels.getPlayerPowerLabel(player, state);
    const vsStats = ROSModels.getPlayerVsUnderStats(state, player.id);
    const vsSummary = ROSModels.summarizeVsUnderStats(vsStats);
    const hasVsHistory = vsSummary.underCount > 0 || vsSummary.praiseCount > 0;
    const showVsBlock = Boolean(week) || displayReasons.vs || displayReasons.praise || hasVsHistory;
    const vsHistoryHtml = hasVsHistory
      ? `<ul class="suivi-vs-history">${vsSummary.entries
          .filter((e) => e.under || e.praise)
          .map(
            (e) =>
              `<li class="${
                e.under ? 'is-under' : e.praise ? 'is-ok' : ''
              }">${escapeHtml(e.weekLabel || e.startDate || 'Semaine')} · ${
                e.underDays
              } j sous objectif · ${
                e.under ? 'sous seuil' : e.praise ? 'à féliciter' : 'neutre'
              }</li>`
          )
          .join('')}</ul>`
      : '';

    const statusOptions = ROSModels.FOLLOW_UP_STATUSES.map(
      (s) =>
        `<option value="${s.id}" ${follow.status === s.id ? 'selected' : ''}>${escapeHtml(
          s.label
        )}</option>`
    ).join('');

    const officers = getAssignableOfficers(state);
    const assigneeOptions =
      `<option value="">— Non assigné —</option>` +
      officers
        .map(
          (p) =>
            `<option value="${escapeHtml(p.id)}" ${
              follow.assigneePlayerId === p.id ? 'selected' : ''
            }>${escapeHtml(p.pseudo)} (${escapeHtml(p.role)})</option>`
        )
        .join('');

    const notesHtml = (follow.notes || [])
      .slice()
      .sort((a, b) => (a.at < b.at ? 1 : -1))
      .map(
        (n) => `
        <article class="suivi-note">
          <header>
            <time datetime="${escapeHtml(n.at)}">${escapeHtml(
              ROSModels.formatCoachingDateTime(n.at) || n.at
            )}</time>
            ${n.authorLabel ? `<span>${escapeHtml(n.authorLabel)}</span>` : ''}
          </header>
          <p>${escapeHtml(n.text)}</p>
        </article>
      `
      )
      .join('');

    els.detail.innerHTML = `
      <div class="suivi-detail-header">
        <div>
          <h3>${escapeHtml(player.pseudo)}</h3>
          <p class="panel-subtitle">${escapeHtml(
            ROSModels.formatFollowUpReasonsLabel(displayReasons)
          )}</p>
        </div>
      </div>
      <div class="suivi-detail-meta">
        ${
          showVsBlock
            ? `<p><strong>VS (semaine active) :</strong> ${
                player.absent
                  ? 'absent — hors scores'
                  : week
                    ? `${underDays} jour(s) sous objectif (${escapeHtml(week.label || '')})`
                    : 'aucune'
              } · seuil suivi ≥ ${settings.vsMinUnderDays} j · félicitations ≥ ${
                settings.vsPraiseMinDaysMet
              } j score fait + ≥ ${settings.vsPraiseMinHighDays} j gros score</p>
        ${
          hasVsHistory
            ? `<p><strong>${escapeHtml(ROSModels.formatVsUnderCounterLabel(vsStats))}</strong>
          · <strong>${escapeHtml(ROSModels.formatVsPraiseCounterLabel(vsStats))}</strong>
          <span class="panel-subtitle"> · ${
            ROSModels.VS_UNDER_HISTORY_LIMIT
          } dernières semaines clôturées</span>
        </p>
        ${vsHistoryHtml}`
            : '<p class="panel-subtitle">Aucun historique VS sous seuil / à féliciter.</p>'
        }`
            : ''
        }
        <p><strong>Puissance héros :</strong> ${escapeHtml(heroLabel)} · seuil ≤ ${
          settings.heroMaxM
        } M</p>
        <p><strong>Contact :</strong> ${
          follow.contactedAt
            ? escapeHtml(ROSModels.formatCoachingDateTime(follow.contactedAt) || follow.contactedAt)
            : 'pas encore'
        }${
          follow.contactedAt
            ? ` · ${escapeHtml(ROSModels.formatFollowUpReasonsLabel(follow.contactReasons))}`
            : ''
        }</p>
        <p><strong>R4 assigné :</strong> ${
          assigneeLabelFor(follow) ? escapeHtml(assigneeLabelFor(follow)) : 'personne'
        }</p>
      </div>
      <label class="field">
        <span>Statut du suivi</span>
        <select id="suiviStatusSelect" class="input" data-suivi-status="${escapeHtml(
          player.id
        )}" ${editable ? '' : 'disabled'}>
          ${statusOptions}
        </select>
      </label>
      <label class="field" style="margin-top:0.65rem">
        <span>Qui suit ce joueur (R4 / R5)</span>
        <select id="suiviAssigneeSelect" class="input" data-suivi-assignee="${escapeHtml(
          player.id
        )}" ${editable ? '' : 'disabled'}>
          ${assigneeOptions}
        </select>
      </label>
      <div class="settings-actions" style="margin-top:0.75rem;gap:0.5rem;flex-wrap:wrap">
        <button type="button" class="btn btn-ghost" data-suivi-contact="${escapeHtml(
          player.id
        )}" ${editable ? '' : 'disabled'}>
          Marquer contacté (date + raisons)
        </button>
        <button type="button" class="btn btn-ghost" data-suivi-done="${escapeHtml(
          player.id
        )}" ${editable ? '' : 'disabled'}>
          Terminer le suivi
        </button>
      </div>
      <div class="suivi-notes-block">
        <h4>Historique des commentaires</h4>
        <div class="suivi-notes-list">${
          notesHtml || '<p class="empty-state">Aucun commentaire pour le moment.</p>'
        }</div>
        ${
          editable
            ? `<form id="suiviNoteForm" class="suivi-note-form" data-player="${escapeHtml(
                player.id
              )}">
            <label class="field">
              <span>Nouveau commentaire</span>
              <textarea id="suiviNoteText" class="input" rows="3" maxlength="800" placeholder="Ex. : tout va bien, questions VS / troupes…" required></textarea>
            </label>
            <button type="submit" class="btn btn-primary">Ajouter le commentaire</button>
          </form>`
            : '<p class="panel-subtitle">Lecture seule — seuls R4/R5 peuvent modifier le suivi.</p>'
        }
      </div>
    `;
  }

  function addManualPlayer() {
    if (!canEditFollowUp()) {
      AppUI.toast('Seul un R4 ou R5 peut ajouter un suivi.');
      return;
    }
    const playerId = els.addSelect?.value;
    if (!playerId) return;
    ROSStorage.update((s) => {
      const row = ensureCase(s, playerId, {
        manual: true,
        reasons: ROSModels.emptyFollowUpReasons({ manual: true }),
        status: 'to_contact',
      });
      row.manual = true;
      row.reasons.manual = true;
      applySpecialistIfNeeded(row, row.reasons, s);
      if (row.status === 'done') {
        row.status = 'to_contact';
        row.closedAt = null;
      }
      row.updatedAt = new Date().toISOString();
      return s;
    });
    selectedPlayerId = playerId;
    showDone = false;
    if (els.showDone) els.showDone.checked = false;
    AppUI.toast('Joueur ajouté au suivi.');
    render();
  }

  function setAssignee(playerId, assigneePlayerId) {
    if (!canEditFollowUp()) {
      AppUI.toast('Seul un R4 ou R5 peut assigner un suivi.');
      return;
    }
    const actor = stampActor();
    ROSStorage.update((s) => {
      const row = ensureCase(s, playerId);
      const nextId = String(assigneePlayerId || '').trim() || null;
      if (!nextId) {
        row.assigneePlayerId = null;
        row.assigneeLabel = '';
        row.assignedAt = null;
        row.assignedByLabel = '';
      } else {
        const officer = (s.players || []).find((p) => p.id === nextId);
        row.assigneePlayerId = nextId;
        row.assigneeLabel = officer?.pseudo || nextId;
        row.assignedAt = new Date().toISOString();
        row.assignedByLabel = actor.actorLabel || '';
      }
      row.updatedAt = new Date().toISOString();
      return s;
    });
    AppUI.toast(assigneePlayerId ? 'R4 assigné.' : 'Assignation retirée.');
    render();
  }

  async function copyDiscordList() {
    const state = ROSStorage.getState();
    const rows = getActiveFollowUpRows(state);
    if (!rows.length) {
      AppUI.toast('Aucune ligne à copier avec les filtres actuels.');
      return;
    }

    const dateLabel = new Date().toLocaleDateString('fr-FR');
    const used = new Set();
    const take = (predicate) =>
      rows.filter((r) => {
        if (used.has(r.player.id) || !predicate(r)) return false;
        used.add(r.player.id);
        return true;
      });

    const groups = [
      { title: 'À féliciter', rows: take((r) => r.reasons.praise) },
      { title: 'Discrets', rows: take((r) => r.reasons.discret) },
      { title: 'À contacter', rows: take((r) => r.follow.status === 'to_contact') },
      { title: 'Autres suivis', rows: take(() => true) },
    ];

    const lines = [`**Suivi membres — ${dateLabel}**`, ''];
    let written = 0;
    groups.forEach((group) => {
      if (!group.rows.length) return;
      lines.push(`**${group.title}** (${group.rows.length})`);
      group.rows.forEach((r) => {
        const motifs = ROSModels.formatFollowUpReasonsLabel(r.reasons);
        const assignee = assigneeLabelFor(r.follow);
        const status =
          r.follow.status !== 'to_contact'
            ? ` · ${ROSModels.getFollowUpStatusLabel(r.follow.status)}`
            : '';
        const who = assignee ? ` · suivi par ${assignee}` : '';
        lines.push(`• ${r.player.pseudo} — ${motifs}${status}${who}`);
        written += 1;
      });
      lines.push('');
    });

    if (!written) {
      AppUI.toast('Aucune ligne à copier.');
      return;
    }

    const text = lines.join('\n').trim();
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      AppUI.toast('Liste copiée — colle-la dans Discord.');
    } catch (_err) {
      AppUI.toast('Impossible de copier automatiquement.');
    }
  }

  function setStatus(playerId, status) {
    if (!canEditFollowUp()) {
      AppUI.toast('Seul un R4 ou R5 peut modifier le suivi.');
      return;
    }
    ROSStorage.update((s) => {
      const row = ensureCase(s, playerId);
      const player = (s.players || []).find((p) => p.id === playerId);
      row.status = ROSModels.normalizeFollowUpStatus(status);
      row.updatedAt = new Date().toISOString();
      if (row.status === 'done') {
        row.closedAt = new Date().toISOString();
        // Terminer un Discret = retirer la case liste, sinon le sync le rouvre aussitôt.
        if (player && (player.discret || row.reasons?.discret)) {
          player.discret = false;
          row.reasons = ROSModels.emptyFollowUpReasons({
            ...row.reasons,
            discret: false,
          });
        }
      } else {
        row.closedAt = null;
      }
      if (row.status === 'contacted' || row.status === 'in_progress') {
        if (!row.contactedAt) {
          const detected = ROSModels.detectFollowUpReasons(player, s);
          row.contactedAt = new Date().toISOString();
          row.contactReasons = ROSModels.emptyFollowUpReasons({
            vs: Boolean(detected.vs || row.reasons.vs),
            hero: Boolean(detected.hero || row.reasons.hero),
            praise: Boolean(detected.praise || row.reasons.praise),
            discret: Boolean(detected.discret || row.reasons.discret || player?.discret),
            manual: Boolean(row.manual || row.reasons.manual),
          });
        }
      }
      return s;
    });
    render();
  }

  function markContacted(playerId) {
    if (!canEditFollowUp()) {
      AppUI.toast('Seul un R4 ou R5 peut modifier le suivi.');
      return;
    }
    ROSStorage.update((s) => {
      const player = s.players.find((p) => p.id === playerId);
      const detected = ROSModels.detectFollowUpReasons(player, s);
      const row = ensureCase(s, playerId);
      row.contactedAt = new Date().toISOString();
      row.contactReasons = ROSModels.emptyFollowUpReasons({
        vs: Boolean(detected.vs || row.reasons.vs),
        hero: Boolean(detected.hero || row.reasons.hero),
        praise: Boolean(detected.praise || row.reasons.praise),
        discret: Boolean(detected.discret || row.reasons.discret || player?.discret),
        manual: Boolean(row.manual || row.reasons.manual),
      });
      if (row.status === 'to_contact') row.status = 'contacted';
      row.updatedAt = new Date().toISOString();
      return s;
    });
    AppUI.toast('Contact enregistré.');
    render();
  }

  function addNote(playerId, text) {
    if (!canEditFollowUp()) {
      AppUI.toast('Seul un R4 ou R5 peut ajouter un commentaire.');
      return;
    }
    const clean = String(text || '').trim();
    if (!clean) return;
    const actor = stampActor();
    ROSStorage.update((s) => {
      const row = ensureCase(s, playerId);
      row.notes = row.notes || [];
      row.notes.push({
        id: ROSModels.uid('funote'),
        at: new Date().toISOString(),
        text: clean,
        authorLabel: actor.actorLabel || '',
        authorUserId: actor.actorUserId || '',
      });
      row.updatedAt = new Date().toISOString();
      if (row.status === 'to_contact' || row.status === 'contacted') {
        row.status = 'in_progress';
      }
      return s;
    });
    AppUI.toast('Commentaire ajouté.');
    render();
  }

  function onRootClick(event) {
    const openBtn = event.target.closest('[data-suivi-open]');
    if (openBtn) {
      selectedPlayerId = openBtn.dataset.suiviOpen;
      render();
      return;
    }
    const contactBtn = event.target.closest('[data-suivi-contact]');
    if (contactBtn) {
      markContacted(contactBtn.dataset.suiviContact);
      return;
    }
    const doneBtn = event.target.closest('[data-suivi-done]');
    if (doneBtn) {
      setStatus(doneBtn.dataset.suiviDone, 'done');
      AppUI.toast('Suivi terminé — retiré de la liste active.');
    }
  }

  function onRootChange(event) {
    const statusSelect = event.target.closest('[data-suivi-status]');
    if (statusSelect) {
      setStatus(statusSelect.dataset.suiviStatus, statusSelect.value);
      return;
    }
    const assigneeSelect = event.target.closest('[data-suivi-assignee]');
    if (assigneeSelect) {
      setAssignee(assigneeSelect.dataset.suiviAssignee, assigneeSelect.value);
    }
  }

  function onRootSubmit(event) {
    const form = event.target.closest('#suiviNoteForm');
    if (!form) return;
    event.preventDefault();
    const playerId = form.dataset.player;
    const text = document.getElementById('suiviNoteText')?.value || '';
    addNote(playerId, text);
  }

  function render() {
    if (!els.root) cacheDom();
    showDone = Boolean(els.showDone?.checked);
    if (els.addWrap) els.addWrap.classList.toggle('hidden', !canEditFollowUp());
    renderList();
  }

  function specialistSelectId(key) {
    const map = {
      vs: 'followUpSpecialistVs',
      praise: 'followUpSpecialistPraise',
      hero: 'followUpSpecialistHero',
      discret: 'followUpSpecialistDiscret',
      manual: 'followUpSpecialistManual',
    };
    return map[key] || '';
  }

  function fillSpecialistSelects(state) {
    const officers = getAssignableOfficers(state);
    const settings = ROSModels.getFollowUpSettings(state);
    const optionsHtml =
      `<option value="">— Non assigné —</option>` +
      officers
        .map(
          (p) =>
            `<option value="${escapeHtml(p.id)}">${escapeHtml(p.pseudo)} (${escapeHtml(
              p.role
            )})</option>`
        )
        .join('');
    ROSModels.FOLLOW_UP_SPECIALIST_KEYS.forEach(({ id }) => {
      const el = document.getElementById(specialistSelectId(id));
      if (!el) return;
      el.innerHTML = optionsHtml;
      el.value = settings.specialists?.[id] || '';
    });
  }

  function renderSettings() {
    const state = ROSStorage.getState();
    const settings = ROSModels.getFollowUpSettings(state);
    const vsEl = document.getElementById('followUpVsMinDays');
    const praiseMetEl = document.getElementById('followUpVsPraiseMinDaysMet');
    const praiseHighEl = document.getElementById('followUpVsPraiseMinHighDays');
    const heroEl = document.getElementById('followUpHeroMax');
    const preview = document.getElementById('followUpSettingsPreview');
    if (vsEl) vsEl.value = settings.vsMinUnderDays;
    if (praiseMetEl) praiseMetEl.value = settings.vsPraiseMinDaysMet;
    if (praiseHighEl) praiseHighEl.value = settings.vsPraiseMinHighDays;
    if (heroEl) heroEl.value = settings.heroMaxM;
    fillSpecialistSelects(state);
    if (preview) {
      const praiseGoal = ROSModels.formatVsMillionsShort(
        ROSModels.getVsSettings(state).afond.praiseGoal
      );
      const specialistBits = ROSModels.FOLLOW_UP_SPECIALIST_KEYS.map(({ id, label }) => {
        const pid = settings.specialists?.[id];
        if (!pid) return null;
        const officer = (state.players || []).find((p) => p.id === pid);
        return `${label}: ${officer?.pseudo || pid}`;
      }).filter(Boolean);
      preview.textContent = `VS suivi : ≥ ${settings.vsMinUnderDays} j sous objectif · À féliciter : ≥ ${settings.vsPraiseMinDaysMet} j score fait + ≥ ${settings.vsPraiseMinHighDays} j ≥ ${praiseGoal} · Héros : ≤ ${settings.heroMaxM} M${
        specialistBits.length ? ` · Référents : ${specialistBits.join(' · ')}` : ''
      }`;
    }
  }

  function saveSettings() {
    if (!(global.ROSProfiles && ROSProfiles.isActiveR5 && ROSProfiles.isActiveR5())) {
      AppUI.toast('Seul le R5 peut modifier les seuils de suivi.');
      return;
    }
    const vsMin = Number(document.getElementById('followUpVsMinDays')?.value);
    const praiseMet = Number(document.getElementById('followUpVsPraiseMinDaysMet')?.value);
    const praiseHigh = Number(document.getElementById('followUpVsPraiseMinHighDays')?.value);
    const heroMax = Number(document.getElementById('followUpHeroMax')?.value);
    const specialists = {};
    ROSModels.FOLLOW_UP_SPECIALIST_KEYS.forEach(({ id }) => {
      const el = document.getElementById(specialistSelectId(id));
      specialists[id] = el?.value || null;
    });
    ROSStorage.update((s) => {
      const prev = ROSModels.getFollowUpSettings(s);
      s.followUpSettings = ROSModels.normalizeFollowUpSettings({
        vsMinUnderDays: vsMin,
        vsPraiseMinDaysMet: praiseMet,
        vsPraiseMinHighDays: praiseHigh,
        heroMaxM: heroMax,
        specialists,
        // Ne pas perdre le mute VS posé par le reset compteurs.
        vsFollowUpMutedWeekId: prev.vsFollowUpMutedWeekId,
      });
      return s;
    });
    renderSettings();
    render();
    AppUI.toast('Seuils et référents enregistrés.');
  }

  async function resetVsUnderCounters() {
    if (!(global.ROSProfiles && ROSProfiles.isActiveR5 && ROSProfiles.isActiveR5())) {
      AppUI.toast('Seul le R5 peut remettre les compteurs VS à zéro.');
      return;
    }
    const ok = await AppUI.confirm({
      title: 'Remettre les compteurs VS à zéro',
      message:
        'Effacer les compteurs « VS sous seuil / À féliciter » et retirer ces motifs des suivis ouverts pour la semaine en cours (ils ne réapparaissent pas tant que tu n’ouvres pas une nouvelle semaine VS). Tempête, Train, héros et manuels ne sont pas touchés.',
      confirmLabel: 'Remettre à zéro',
    });
    if (!ok) return;
    ROSStorage.update((s) => {
      s.playerVsUnderStats = {};
      const refWeek = ROSModels.getFollowUpReferenceWeek(s);
      const prev = ROSModels.getFollowUpSettings(s);
      s.followUpSettings = ROSModels.normalizeFollowUpSettings({
        ...prev,
        vsFollowUpMutedWeekId: refWeek?.id || null,
      });
      // Retire VS / félicitations des fiches ouvertes (la semaine muette empêche la redétection).
      Object.keys(s.playerFollowUps || {}).forEach((playerId) => {
        const row = s.playerFollowUps[playerId];
        if (!row || row.status === 'done') return;
        row.reasons = ROSModels.emptyFollowUpReasons({
          vs: false,
          praise: false,
          hero: Boolean(row.reasons?.hero),
          discret: Boolean(row.reasons?.discret),
          manual: Boolean(row.manual || row.reasons?.manual),
        });
        row.manual = Boolean(row.manual || row.reasons.manual);
        const stillRelevant =
          row.reasons.hero || row.reasons.discret || row.manual;
        if (!stillRelevant) {
          row.status = 'done';
          row.closedAt = new Date().toISOString();
        }
        row.updatedAt = new Date().toISOString();
      });
      return s;
    });
    render();
    AppUI.toast('Compteurs et suivis VS nettoyés pour la semaine en cours.');
  }

  function contactOfficerLabel(follow) {
    if (follow?.assigneeLabel) return follow.assigneeLabel;
    if (follow?.assigneePlayerId) {
      const state = ROSStorage.getState();
      const officer = (state.players || []).find((p) => p.id === follow.assigneePlayerId);
      if (officer?.pseudo) return officer.pseudo;
    }
    const notes = Array.isArray(follow?.notes) ? follow.notes : [];
    for (let i = notes.length - 1; i >= 0; i -= 1) {
      if (notes[i]?.authorLabel) return notes[i].authorLabel;
    }
    return '—';
  }

  function formatNotesPreview(follow, maxLen = 160) {
    const notes = Array.isArray(follow?.notes) ? follow.notes.slice() : [];
    if (!notes.length) return '—';
    notes.sort((a, b) => (a.at < b.at ? 1 : -1));
    const text = notes
      .map((n) => String(n.text || '').trim())
      .filter(Boolean)
      .join(' · ');
    if (!text) return '—';
    if (text.length <= maxLen) return text;
    return `${text.slice(0, maxLen - 1)}…`;
  }

  function getDoneFollowUpRows(state) {
    const q = (document.getElementById('historiqueSuiviSearch')?.value || '')
      .trim()
      .toLowerCase();
    return (state.players || [])
      .filter((p) => p && p.status === 'Actif')
      .map((player) => {
        const follow = state.playerFollowUps?.[player.id];
        if (!follow || follow.status !== 'done') return null;
        // Motifs au moment du suivi (pas la redétection live actuelle).
        const reasons = ROSModels.emptyFollowUpReasons({
          vs: Boolean(follow.reasons?.vs || follow.contactReasons?.vs),
          hero: Boolean(follow.reasons?.hero || follow.contactReasons?.hero),
          praise: Boolean(follow.reasons?.praise || follow.contactReasons?.praise),
          discret: Boolean(follow.reasons?.discret || follow.contactReasons?.discret),
          manual: Boolean(
            follow.manual || follow.reasons?.manual || follow.contactReasons?.manual
          ),
        });
        return { player, follow, reasons };
      })
      .filter(Boolean)
      .filter((row) =>
        ROSModels.isFollowUpVisibleToViewer(row, state, viewerPlayerId(), viewerIsR5())
      )
      .filter((row) => {
        if (!q) return true;
        return String(row.player.pseudo || '')
          .toLowerCase()
          .includes(q);
      })
      .sort((a, b) => {
        const ca = a.follow.closedAt || a.follow.updatedAt || '';
        const cb = b.follow.closedAt || b.follow.updatedAt || '';
        if (ca !== cb) return ca < cb ? 1 : -1;
        return a.player.pseudo.localeCompare(b.player.pseudo, 'fr', { sensitivity: 'base' });
      });
  }

  function reactivateFollowUp(playerId) {
    if (!canEditFollowUp()) {
      AppUI.toast('Seul un R4 ou R5 peut réactiver un suivi.');
      return;
    }
    ROSStorage.update((s) => {
      const row = s.playerFollowUps?.[playerId];
      if (!row || row.status !== 'done') return s;
      const player = (s.players || []).find((p) => p.id === playerId);
      row.status = 'to_contact';
      row.closedAt = null;
      row.updatedAt = new Date().toISOString();
      // Restaure Discret si la fiche / le contact l’avait.
      if (row.reasons?.discret || row.contactReasons?.discret) {
        if (player) player.discret = true;
        row.reasons = ROSModels.emptyFollowUpReasons({
          ...row.reasons,
          discret: true,
        });
      }
      const still =
        row.reasons?.vs ||
        row.reasons?.hero ||
        row.reasons?.praise ||
        row.reasons?.discret ||
        row.manual ||
        row.reasons?.manual;
      if (!still) {
        row.manual = true;
        row.reasons = ROSModels.emptyFollowUpReasons({
          ...row.reasons,
          manual: true,
        });
      }
      applySpecialistIfNeeded(row, row.reasons, s);
      return s;
    });
    selectedPlayerId = playerId;
    showDone = false;
    if (els.showDone) els.showDone.checked = false;
    AppUI.toast('Suivi réactivé.');
    renderHistory();
    if (global.AppUI && typeof AppUI.switchTab === 'function') {
      AppUI.switchTab('suivi');
    } else {
      render();
    }
  }

  async function clearDoneFollowUpHistory() {
    if (!(global.ROSProfiles && ROSProfiles.isActiveR5 && ROSProfiles.isActiveR5())) {
      AppUI.toast('Seul le R5 peut effacer l’historique des suivis.');
      return;
    }
    const state = ROSStorage.getState();
    const doneCount = Object.values(state.playerFollowUps || {}).filter(
      (row) => row && row.status === 'done'
    ).length;
    if (!doneCount) {
      AppUI.toast('Aucun suivi terminé à effacer.');
      return;
    }
    const ok = await AppUI.confirm({
      title: 'Effacer tout l’historique suivi',
      message: `Supprimer définitivement ${doneCount} fiche(s) terminée(s) (notes et dates comprises) ? Les suivis encore ouverts dans Gestion des membres ne sont pas touchés.`,
      confirmLabel: 'Effacer l’historique',
    });
    if (!ok) return;
    ROSStorage.update((s) => {
      const next = {};
      Object.keys(s.playerFollowUps || {}).forEach((playerId) => {
        const row = s.playerFollowUps[playerId];
        if (!row || row.status === 'done') return;
        next[playerId] = row;
      });
      s.playerFollowUps = next;
      return s;
    });
    renderHistory();
    render();
    AppUI.toast('Historique des suivis terminés effacé.');
  }

  function renderHistory() {
    const body = document.getElementById('historiqueSuiviBody');
    const empty = document.getElementById('historiqueSuiviEmpty');
    const counter = document.getElementById('historiqueSuiviCounter');
    const clearBtn = document.getElementById('btnClearSuiviHistory');
    if (!body) return;
    const state = ROSStorage.getState();
    const rows = getDoneFollowUpRows(state);
    if (counter) counter.textContent = `${rows.length} fiche(s) terminée(s)`;
    if (empty) empty.classList.toggle('hidden', rows.length > 0);
    if (clearBtn) {
      const isR5 = Boolean(
        global.ROSProfiles && ROSProfiles.isActiveR5 && ROSProfiles.isActiveR5()
      );
      clearBtn.classList.toggle('hidden', !isR5);
      clearBtn.disabled = rows.length === 0;
    }
    const editable = canEditFollowUp();
    body.innerHTML = rows
      .map(({ player, follow, reasons }) => {
        const closed =
          ROSModels.formatCoachingDateTime(follow.closedAt) ||
          ROSModels.formatCoachingDateTime(follow.updatedAt) ||
          '—';
        const r4 = contactOfficerLabel(follow);
        const notes = formatNotesPreview(follow);
        const motifs = ROSModels.formatFollowUpReasonsLabel(reasons);
        return `
          <tr>
            <td><strong>${escapeHtml(player.pseudo)}</strong></td>
            <td>${escapeHtml(motifs)}</td>
            <td>${escapeHtml(r4)}</td>
            <td>${escapeHtml(closed)}</td>
            <td class="historique-suivi-notes">${escapeHtml(notes)}</td>
            <td class="table-actions">
              ${
                editable
                  ? `<button type="button" class="btn btn-primary btn-sm" data-historique-reactivate="${escapeHtml(
                      player.id
                    )}">Réactiver</button>`
                  : '—'
              }
            </td>
          </tr>
        `;
      })
      .join('');
  }

  function onHistoryClick(event) {
    const btn = event.target.closest('[data-historique-reactivate]');
    if (!btn) return;
    reactivateFollowUp(btn.dataset.historiqueReactivate);
  }

  function init() {
    cacheDom();
    els.search?.addEventListener('input', () => render());
    els.filterStatus?.addEventListener('change', () => render());
    els.filterReason?.addEventListener('change', () => render());
    els.filterAssignee?.addEventListener('change', () => render());
    els.showDone?.addEventListener('change', () => render());
    els.btnCopyList?.addEventListener('click', () => {
      void copyDiscordList();
    });
    els.btnAdd?.addEventListener('click', addManualPlayer);
    els.root?.addEventListener('click', onRootClick);
    els.root?.addEventListener('change', onRootChange);
    els.root?.addEventListener('submit', onRootSubmit);
    document.getElementById('btnSaveFollowUpSettings')?.addEventListener('click', saveSettings);
    document.getElementById('btnResetVsUnderCounters')?.addEventListener('click', () => {
      void resetVsUnderCounters();
    });
    document.getElementById('historiqueSuiviSearch')?.addEventListener('input', () => renderHistory());
    document.getElementById('historiqueSuiviBody')?.addEventListener('click', onHistoryClick);
    document.getElementById('btnClearSuiviHistory')?.addEventListener('click', () => {
      void clearDoneFollowUpHistory();
    });
  }

  global.SuiviModule = {
    init,
    render,
    renderHistory,
    renderSettings,
    canEditFollowUp,
  };
})(window);
