/**
 * Traductions UI Ruche — FR / EN.
 * Préférence personnelle navigateur uniquement (localStorage).
 * Ne jamais synchroniser vers ros6_state / ros6_ruche_v1.
 */
(function (global) {
  const STORAGE_KEY = 'warops_ruche_ui_lang';
  const DEFAULT_LANG = 'fr';

  const fr = {
    'tab.ruche': 'Ruche',
    'title': 'Ruche',
    'subtitle': 'Plan de ruche {tag} — 101 cases (10 × 10 + bas) · Maréchal au centre',
    'subtitle.fallback':
      'Plan de ruche — 101 cases (10 × 10 + bas) · événement Maréchal fixe au centre',
    'lang.aria': 'Langue de l’interface Ruche',
    'lang.fr': 'Français',
    'lang.en': 'English',

    'current.title': 'Ruche actuelle',
    'current.help': 'Ruche enregistrée — ne change jamais automatiquement',
    'btn.verify': 'Vérifier la ruche',
    'btn.validate': 'Valider la ruche',
    'btn.exportPng': 'Exporter en PNG',
    'btn.exportExcel': 'Exporter en Excel',
    'btn.clear': 'Vider la grille',
    'grid.aria': 'Grille de ruche actuelle 10 par 10',

    'proposal.title': 'Proposition optimisée',
    'proposal.help':
      'R4/R5 au plus près du Maréchal (sans regarder leur puissance héros), puis membres par puissance héros (plus fort → plus près) · n’écrase la ruche actuelle qu’après validation',
    'proposal.stats.empty': 'Gain estimé : 0 % · Déplacements : 0 joueurs',
    'proposal.stats.rosterEmpty': 'Effectif — Retirés : 0 · Nouveaux : 0 · Conservés : 0',
    'proposal.stats.line':
      'Gain estimé : <strong>{gain} %</strong> · Déplacements : <strong>{moved}</strong> joueurs<br><span class="panel-subtitle">Effectif — Retirés : <strong>{removed}</strong> · Nouveaux : <strong>{added}</strong> · Conservés : <strong>{kept}</strong></span>',
    'proposal.mode.label': 'Mode de génération',
    'proposal.mode.aria': 'Mode de génération de proposition',
    'proposal.mode.soft': 'Optimisation douce',
    'proposal.mode.full': 'Nouveau plan complet',
    'proposal.officers.label': 'Autoriser aussi l’optimiseur à déplacer les R4/R5',
    'proposal.officers.hint': '(sinon ils sont placés près du Maréchal puis verrouillés)',
    'proposal.officers.aria': 'Autoriser le déplacement des R4/R5',
    'proposal.btn.generate': 'Générer la proposition',
    'proposal.btn.validate': 'Valider cette proposition comme nouvelle ruche',
    'proposal.grid.aria': 'Proposition de ruche optimisée',

    'archives.title': 'Archives ruche',
    'archives.help': 'Plans validés — consultation seule',
    'archives.empty': 'Aucun plan validé pour le moment.',
    'archives.fallbackLabel': 'Plan ruche',
    'archives.fallbackPreview': 'Plan archivé',
    'archives.meta': '{date} · {players} joueurs · {free} FREE',
    'archives.view': 'Consulter',
    'archives.preview.meta': 'Maréchal : événement centre · Bas : {bottom}',

    'colors.title': 'Couleurs Ruche',
    'colors.help': 'Couleurs du plan de ruche — module Ruche uniquement',
    'colors.marshal': 'Maréchal',
    'colors.r4': 'R5 / R4',
    'colors.free': 'FREE',

    'cell.marshal': 'Maréchal',
    'cell.marshalCenter': 'Maréchal (centre)',
    'cell.bottom': 'Bas',
    'cell.eventBadge': 'ÉVÉNEMENT',
    'cell.empty': '—',
    'aria.marshalFixed': 'Événement Maréchal (case fixe)',
    'aria.proposalMarshal': 'Proposition — événement Maréchal (fixe)',
    'aria.proposalBottom': 'Proposition — case du bas',
    'aria.proposalCell': 'Proposition — case {row}, {col}',
    'aria.bottom': 'Case du bas — joueur',
    'aria.cell': 'Case {row}, {col}',

    'toast.proposal.full.movable':
      'Nouveau plan complet généré (R4/R5 déplaçables). {roster}',
    'toast.proposal.full.kept':
      'Nouveau plan complet généré (R4/R5 conservés). {roster}',
    'toast.proposal.soft': 'Optimisation douce recalculée. {roster}',
    'toast.roster': 'Retirés : {removed} · Nouveaux : {added} · Conservés : {kept}',
    'toast.proposal.none': 'Aucune proposition à valider.',
    'toast.proposal.validated': 'Proposition validée — nouvelle ruche actuelle.',
    'toast.verify.ok': 'Ruche conforme — validation possible.',
    'toast.verify.issues': 'Vérification terminée — des écarts restent.',
    'toast.validate.blocked': 'Validation impossible — corrigez les écarts.',
    'toast.archived': 'Plan de ruche archivé.',
    'toast.cleared': 'Grille vidée.',
    'toast.png.fail': 'Export PNG impossible.',
    'toast.png.ok': 'PNG téléchargé.',
    'toast.excel.ok': 'Fichier Excel téléchargé.',

    'confirm.cancel': 'Annuler',
    'confirm.proposal.title': 'Valider cette proposition comme nouvelle ruche',
    'confirm.proposal.message':
      'Remplacer directement la ruche actuelle par la proposition ?\n\nGain estimé : {gain} %\nDéplacements : {moved} joueurs\n\nAucune archive ne sera créée.',
    'confirm.proposal.ok': 'Valider comme nouvelle ruche',
    'confirm.validate.title': 'Valider la ruche',
    'confirm.validate.message':
      'Archiver ce plan de ruche ? Le plan courant reste modifiable ensuite.',
    'confirm.validate.ok': 'Valider et archiver',
    'confirm.clear.title': 'Vider la grille',
    'confirm.clear.message':
      'Retirer tous les joueurs et FREE ? La case Maréchal (centre) reste en place.',
    'confirm.clear.ok': 'Vider',

    'verify.title': 'Résultat de la vérification',
    'verify.totalCases': 'Cases totales : {count} / {total}',
    'verify.playerSlots': 'Cases joueurs : {count} / {total}',
    'verify.activeExpected': 'Joueurs actifs attendus : {count}',
    'verify.placed': 'Joueurs placés : {count}',
    'verify.free': 'Cases FREE : {count}',
    'verify.marshal': 'Maréchal : {label}',
    'verify.duplicates': 'Doublons : {count}',
    'verify.missingCount': 'Joueurs manquants : {count}',
    'verify.missingTitle': 'Joueurs manquants',
    'verify.valid':
      'Ruche valide — {active} joueurs actifs, {free} FREE, événement Maréchal au centre.',
    'verify.issue.marshalCenter': 'La case centrale doit être l’événement Maréchal',
    'verify.issue.marshalFree': 'La case Maréchal ne peut pas être FREE',
    'verify.issue.marshalOffCenter': 'Sentinelle Maréchal hors centre ({row},{col})',
    'verify.issue.emptySlots':
      'Cases joueurs vides : {count} (marquez-les FREE si aucun joueur)',
    'verify.issue.inconsistent':
      'Cases joueurs incohérentes : {players} joueurs + {free} FREE ≠ {slots}',
    'verify.issue.dupList': 'Doublons détectés : {list}',
    'verify.issue.unknown': 'Valeurs inconnues / joueurs non actifs : {list}',
    'verify.issue.extras': 'Hors effectif actif : {list}',

    'export.pngTitle': '{tag} — Plan de ruche',
    'export.sheetName': 'Ruche',
  };

  const en = {
    'tab.ruche': 'Hive',
    'title': 'Hive',
    'subtitle': 'Hive plan {tag} — 101 slots (10 × 10 + bottom) · Marshal at centre',
    'subtitle.fallback':
      'Hive plan — 101 slots (10 × 10 + bottom) · fixed Marshal event at centre',
    'lang.aria': 'Hive interface language',
    'lang.fr': 'Français',
    'lang.en': 'English',

    'current.title': 'Current hive',
    'current.help': 'Saved hive — never changes automatically',
    'btn.verify': 'Verify hive',
    'btn.validate': 'Validate hive',
    'btn.exportPng': 'Export PNG',
    'btn.exportExcel': 'Export Excel',
    'btn.clear': 'Clear grid',
    'grid.aria': 'Current hive grid 10 by 10',

    'proposal.title': 'Optimised proposal',
    'proposal.help':
      'R4/R5 closest to the Marshal (ignoring hero power), then members by hero power (stronger → closer) · only overwrites the current hive after validation',
    'proposal.stats.empty': 'Estimated gain: 0% · Moves: 0 players',
    'proposal.stats.rosterEmpty': 'Roster — Removed: 0 · New: 0 · Kept: 0',
    'proposal.stats.line':
      'Estimated gain: <strong>{gain}%</strong> · Moves: <strong>{moved}</strong> players<br><span class="panel-subtitle">Roster — Removed: <strong>{removed}</strong> · New: <strong>{added}</strong> · Kept: <strong>{kept}</strong></span>',
    'proposal.mode.label': 'Generation mode',
    'proposal.mode.aria': 'Proposal generation mode',
    'proposal.mode.soft': 'Soft optimisation',
    'proposal.mode.full': 'Full new plan',
    'proposal.officers.label': 'Also allow the optimiser to move R4/R5',
    'proposal.officers.hint': '(otherwise they are seated near the Marshal then locked)',
    'proposal.officers.aria': 'Allow moving R4/R5',
    'proposal.btn.generate': 'Generate proposal',
    'proposal.btn.validate': 'Validate this proposal as the new hive',
    'proposal.grid.aria': 'Optimised hive proposal',

    'archives.title': 'Hive archives',
    'archives.help': 'Validated plans — view only',
    'archives.empty': 'No validated plan yet.',
    'archives.fallbackLabel': 'Hive plan',
    'archives.fallbackPreview': 'Archived plan',
    'archives.meta': '{date} · {players} players · {free} FREE',
    'archives.view': 'View',
    'archives.preview.meta': 'Marshal: centre event · Bottom: {bottom}',

    'colors.title': 'Hive colours',
    'colors.help': 'Hive plan colours — Hive module only',
    'colors.marshal': 'Marshal',
    'colors.r4': 'R5 / R4',
    'colors.free': 'FREE',

    'cell.marshal': 'Marshal',
    'cell.marshalCenter': 'Marshal (centre)',
    'cell.bottom': 'Bottom',
    'cell.eventBadge': 'EVENT',
    'cell.empty': '—',
    'aria.marshalFixed': 'Marshal event (fixed cell)',
    'aria.proposalMarshal': 'Proposal — Marshal event (fixed)',
    'aria.proposalBottom': 'Proposal — bottom cell',
    'aria.proposalCell': 'Proposal — cell {row}, {col}',
    'aria.bottom': 'Bottom cell — player',
    'aria.cell': 'Cell {row}, {col}',

    'toast.proposal.full.movable':
      'Full new plan generated (R4/R5 movable). {roster}',
    'toast.proposal.full.kept':
      'Full new plan generated (R4/R5 kept). {roster}',
    'toast.proposal.soft': 'Soft optimisation recalculated. {roster}',
    'toast.roster': 'Removed: {removed} · New: {added} · Kept: {kept}',
    'toast.proposal.none': 'No proposal to validate.',
    'toast.proposal.validated': 'Proposal validated — now the current hive.',
    'toast.verify.ok': 'Hive valid — validation available.',
    'toast.verify.issues': 'Verification finished — issues remain.',
    'toast.validate.blocked': 'Validation blocked — fix the issues.',
    'toast.archived': 'Hive plan archived.',
    'toast.cleared': 'Grid cleared.',
    'toast.png.fail': 'PNG export failed.',
    'toast.png.ok': 'PNG downloaded.',
    'toast.excel.ok': 'Excel file downloaded.',

    'confirm.cancel': 'Cancel',
    'confirm.proposal.title': 'Validate this proposal as the new hive',
    'confirm.proposal.message':
      'Replace the current hive with the proposal now?\n\nEstimated gain: {gain}%\nMoves: {moved} players\n\nNo archive will be created.',
    'confirm.proposal.ok': 'Validate as new hive',
    'confirm.validate.title': 'Validate hive',
    'confirm.validate.message':
      'Archive this hive plan? The current plan remains editable afterwards.',
    'confirm.validate.ok': 'Validate and archive',
    'confirm.clear.title': 'Clear grid',
    'confirm.clear.message':
      'Remove all players and FREE? The Marshal cell (centre) stays in place.',
    'confirm.clear.ok': 'Clear',

    'verify.title': 'Verification result',
    'verify.totalCases': 'Total cells: {count} / {total}',
    'verify.playerSlots': 'Player cells: {count} / {total}',
    'verify.activeExpected': 'Expected active players: {count}',
    'verify.placed': 'Players placed: {count}',
    'verify.free': 'FREE cells: {count}',
    'verify.marshal': 'Marshal: {label}',
    'verify.duplicates': 'Duplicates: {count}',
    'verify.missingCount': 'Missing players: {count}',
    'verify.missingTitle': 'Missing players',
    'verify.valid':
      'Hive valid — {active} active players, {free} FREE, Marshal event at centre.',
    'verify.issue.marshalCenter': 'The centre cell must be the Marshal event',
    'verify.issue.marshalFree': 'The Marshal cell cannot be FREE',
    'verify.issue.marshalOffCenter': 'Marshal sentinel off centre ({row},{col})',
    'verify.issue.emptySlots':
      'Empty player cells: {count} (mark them FREE if no player)',
    'verify.issue.inconsistent':
      'Inconsistent player cells: {players} players + {free} FREE ≠ {slots}',
    'verify.issue.dupList': 'Duplicates detected: {list}',
    'verify.issue.unknown': 'Unknown values / inactive players: {list}',
    'verify.issue.extras': 'Outside active roster: {list}',

    'export.pngTitle': '{tag} — Hive plan',
    'export.sheetName': 'Hive',
  };

  const DICTS = { fr, en };

  function normalizeLang(value) {
    return String(value || '').trim().toLowerCase() === 'en' ? 'en' : 'fr';
  }

  function readStoredLang() {
    try {
      return normalizeLang(global.localStorage?.getItem(STORAGE_KEY));
    } catch (error) {
      return DEFAULT_LANG;
    }
  }

  let currentLang = readStoredLang();

  function getLang() {
    return currentLang;
  }

  function getDateLocale() {
    return currentLang === 'en' ? 'en-GB' : 'fr-FR';
  }

  function getCompareLocale() {
    return currentLang === 'en' ? 'en' : 'fr';
  }

  function t(key, vars) {
    const dict = DICTS[currentLang] || DICTS.fr;
    let str = dict[key];
    if (str == null || str === '') str = DICTS.fr[key];
    if (str == null) str = key;
    if (vars && typeof vars === 'object') {
      Object.keys(vars).forEach((name) => {
        str = String(str).split(`{${name}}`).join(String(vars[name]));
      });
    }
    return str;
  }

  function writeStoredLang(lang) {
    try {
      global.localStorage?.setItem(STORAGE_KEY, lang);
    } catch (error) {
      // quota / private mode — ignore
    }
  }

  function applyStaticDom(root) {
    const scope = root || global.document;
    if (!scope || typeof scope.querySelectorAll !== 'function') return;

    scope.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (!key) return;
      el.textContent = t(key);
    });
    scope.querySelectorAll('[data-i18n-html]').forEach((el) => {
      const key = el.getAttribute('data-i18n-html');
      if (!key) return;
      el.innerHTML = t(key);
    });
    scope.querySelectorAll('[data-i18n-aria]').forEach((el) => {
      const key = el.getAttribute('data-i18n-aria');
      if (!key) return;
      el.setAttribute('aria-label', t(key));
    });
    scope.querySelectorAll('[data-i18n-title]').forEach((el) => {
      const key = el.getAttribute('data-i18n-title');
      if (!key) return;
      el.setAttribute('title', t(key));
    });
    scope.querySelectorAll('option[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (!key) return;
      el.textContent = t(key);
    });

    scope.querySelectorAll('[data-ruche-lang]').forEach((btn) => {
      const lang = normalizeLang(btn.getAttribute('data-ruche-lang'));
      btn.classList.toggle('is-active', lang === currentLang);
      btn.setAttribute('aria-pressed', lang === currentLang ? 'true' : 'false');
    });
  }

  function setLang(next, options = {}) {
    const lang = normalizeLang(next);
    const changed = lang !== currentLang;
    currentLang = lang;
    writeStoredLang(lang);
    if (options.applyDom !== false) applyStaticDom(options.root);
    if (typeof options.onChange === 'function' && (changed || options.force)) {
      options.onChange(lang);
    }
    return lang;
  }

  function formatDateTime(isoOrDate) {
    if (!isoOrDate) return t('cell.empty');
    const date = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
    if (Number.isNaN(date.getTime())) return t('cell.empty');
    return date.toLocaleString(getDateLocale());
  }

  global.RucheI18n = {
    STORAGE_KEY,
    DEFAULT_LANG,
    DICTS,
    t,
    getLang,
    setLang,
    normalizeLang,
    readStoredLang,
    applyStaticDom,
    getDateLocale,
    getCompareLocale,
    formatDateTime,
    frKeyCount: Object.keys(fr).length,
    enKeyCount: Object.keys(en).length,
  };
})(typeof window !== 'undefined' ? window : global);
