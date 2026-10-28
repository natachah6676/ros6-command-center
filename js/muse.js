/**
 * La Muse — notification quotidienne Last War.
 * Préparation commune (ros6_muse_v1) et brouillon individuel par compte.
 * Phrases fixes, sans API externe.
 */
(function (global) {
  const STORAGE_KEY = 'ros6_muse_v1';
  const MAX_CHARS = 500;
  const ENDING = 'Soyez heureux mes préférés !';
  const SHIELD = "N'oubliez pas votre bouclier !";
  const GREETING = 'Coucou les ROS6 :)';
  const PHRASES = {
    vsFond: "Aujourd'hui, on donne tout pour le VS !",
    vsEco: 'Journée économique au VS, gardez vos ressources pour la suite !',
    vs72: 'Faites de votre mieux pour atteindre les 7,2 millions de points au VS !',
    storm: 'Pensez à vous inscrire à la Tempête du désert et à indiquer vos disponibilités.',
    gold: 'Laissez 10 minutes au découvreur pour tuer les Boss svp.',
    general:
      'Passez au niveau supérieur lorsque vous réussissez seuls au moins 80 % du niveau précédent.',
  };
  const MONTHS = [
    'janvier',
    'février',
    'mars',
    'avril',
    'mai',
    'juin',
    'juillet',
    'août',
    'septembre',
    'octobre',
    'novembre',
    'décembre',
  ];
  const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  const PLAN_PRESETS = [
    { kind: 'chasseur', label: 'Chasseur de primes' },
    { kind: 'marche', label: 'Marché scintillant' },
    { kind: 'bullseyes', label: 'Butin de BullEyes' },
  ];
  const STEP_LABELS = [
    'Date et événements',
    'VS',
    'Maréchal',
    'Sondages et événements',
    'Consigne',
    'Notification',
  ];

  let state = null;
  let seenSharedAt = '';
  let remoteSharedChanged = false;
  let view = 'wizard';
  let step = 1;
  let paintKey = '';
  let painting = false;
  let bound = false;
  const timers = {};

  function defaultSettings() {
    return {
      marshalAnchorDate: '2026-10-29',
      marshalTime: '21:00',
      marshalFridayTime: '20:00',
      zombieWeekdays: [1, 4],
      zombieTime: '21:00',
      zombieTimeWithMarshal: '21:30',
    };
  }

  function createBlank() {
    return {
      version: 1,
      sharedUpdatedAt: '',
      sharedUpdatedBy: '',
      settings: defaultSettings(),
      exceptions: [],
      prep: {
        date: '',
        vsByDate: {},
        marshalLevelByDate: {},
        polls: [],
        bonsPlans: [],
        zombiesDores: false,
        general: false,
        svsActive: false,
        svsServer: '',
        dailyNotes: {},
      },
      drafts: {},
    };
  }

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function parseISODate(iso) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!match) return null;
    const y = Number(match[1]);
    const m = Number(match[2]);
    const d = Number(match[3]);
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    const utc = Date.UTC(y, m - 1, d);
    const check = new Date(utc);
    if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
      return null;
    }
    return { y, m, d, utc };
  }

  function weekday(iso) {
    const parsed = parseISODate(iso);
    if (!parsed) return -1;
    return new Date(parsed.utc).getUTCDay();
  }

  function addDays(iso, amount) {
    const parsed = parseISODate(iso);
    if (!parsed) return '';
    const next = new Date(parsed.utc + amount * 86400000);
    const y = next.getUTCFullYear();
    const m = String(next.getUTCMonth() + 1).padStart(2, '0');
    const d = String(next.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function daysBetween(from, to) {
    const a = parseISODate(from);
    const b = parseISODate(to);
    if (!a || !b) return NaN;
    return Math.round((b.utc - a.utc) / 86400000);
  }

  function parisToday(now) {
    try {
      const fmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Paris',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      const parts = fmt.formatToParts(now || new Date());
      const y = parts.find((part) => part.type === 'year')?.value;
      const m = parts.find((part) => part.type === 'month')?.value;
      const d = parts.find((part) => part.type === 'day')?.value;
      const iso = `${y}-${m}-${d}`;
      if (parseISODate(iso)) return iso;
    } catch (error) {
      /* repli calendrier local */
    }
    const dt = now || new Date();
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  }

  function validTime(value) {
    const match = /^(\d{2}):(\d{2})$/.exec(String(value || ''));
    if (!match) return '';
    const h = Number(match[1]);
    const m = Number(match[2]);
    if (h > 23 || m > 59) return '';
    return `${match[1]}:${match[2]}`;
  }

  function formatHeure(hhmm) {
    const time = validTime(hhmm);
    if (!time) return '';
    const [hs, ms] = time.split(':');
    const h = String(Number(hs));
    if (ms === '00') return `${h}h`;
    return `${h}h${ms}`;
  }

  function formatDateFr(iso, withYear) {
    const parsed = parseISODate(iso);
    if (!parsed) return '';
    const base = `${parsed.d} ${MONTHS[parsed.m - 1]}`;
    return withYear ? `${base} ${parsed.y}` : base;
  }

  function formatTitle(iso) {
    return `Programme du ${formatDateFr(iso)}`;
  }

  function sundayOnOrAfter(iso) {
    const day = weekday(iso);
    if (day < 0) return '';
    if (day === 0) return iso;
    return addDays(iso, 7 - day);
  }

  function uid(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function hasEmoji(text) {
    return /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}\u{1F1E6}-\u{1F1FF}]/u.test(
      String(text || '')
    );
  }

  function stripEmoji(text) {
    return String(text || '').replace(
      /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}\u{1F1E6}-\u{1F1FF}]/gu,
      ''
    );
  }

  function cleanLine(text, max) {
    const clean = stripEmoji(String(text || ''))
      .replace(/[\r\n]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return clean.slice(0, max || 80);
  }

  function normalizeSettings(raw) {
    const base = defaultSettings();
    const source = Array.isArray(raw?.zombieWeekdays) ? raw.zombieWeekdays : base.zombieWeekdays;
    const days = [...new Set(source.map(Number).filter((n) => n >= 0 && n <= 6 && Number.isInteger(n)))].sort(
      (a, b) => a - b
    );
    return {
      marshalAnchorDate: parseISODate(raw?.marshalAnchorDate) ? raw.marshalAnchorDate : base.marshalAnchorDate,
      marshalTime: validTime(raw?.marshalTime) || base.marshalTime,
      marshalFridayTime: validTime(raw?.marshalFridayTime) || base.marshalFridayTime,
      zombieWeekdays: Array.isArray(raw?.zombieWeekdays) ? days : base.zombieWeekdays.slice(),
      zombieTime: validTime(raw?.zombieTime) || base.zombieTime,
      zombieTimeWithMarshal: validTime(raw?.zombieTimeWithMarshal) || base.zombieTimeWithMarshal,
    };
  }

  function normalizeException(raw) {
    if (!raw || (raw.kind !== 'marshal' && raw.kind !== 'zombie')) return null;
    if (raw.action !== 'cancel' && raw.action !== 'move') return null;
    if (!parseISODate(raw.date)) return null;
    const item = {
      id: String(raw.id || uid('ex')).slice(0, 48),
      kind: raw.kind,
      action: raw.action,
      date: raw.date,
    };
    if (raw.action === 'move') {
      if (!parseISODate(raw.toDate) || raw.toDate === raw.date) return null;
      item.toDate = raw.toDate;
      const time = validTime(raw.time);
      if (time) item.time = time;
    }
    return item;
  }

  function normalizeDraft(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const forDate = parseISODate(raw.forDate) ? raw.forDate : '';
    if (!forDate) return null;
    return {
      text: String(raw.text || '').slice(0, 4000),
      updatedAt: String(raw.updatedAt || ''),
      forDate,
      omitted: Array.isArray(raw.omitted) ? raw.omitted.map((item) => String(item)).slice(0, 30) : [],
      warnings: Array.isArray(raw.warnings) ? raw.warnings.map((item) => String(item)).slice(0, 10) : [],
    };
  }

  function normalize(raw) {
    const blank = createBlank();
    const src = raw && typeof raw === 'object' ? raw : {};
    const prep = src.prep && typeof src.prep === 'object' ? src.prep : {};
    const vsByDate = {};
    if (prep.vsByDate && typeof prep.vsByDate === 'object') {
      Object.keys(prep.vsByDate).forEach((key) => {
        if (!parseISODate(key)) return;
        const mode = prep.vsByDate[key];
        if (mode === 'fond' || mode === 'economie' || mode === '72m') vsByDate[key] = mode;
      });
    }
    const marshalLevelByDate = {};
    if (prep.marshalLevelByDate && typeof prep.marshalLevelByDate === 'object') {
      Object.keys(prep.marshalLevelByDate).forEach((key) => {
        if (!parseISODate(key)) return;
        const level = String(prep.marshalLevelByDate[key] || '').replace(/\D/g, '').slice(0, 3);
        if (level) marshalLevelByDate[key] = level;
      });
    }
    const polls = (Array.isArray(prep.polls) ? prep.polls : [])
      .map((poll) => ({
        id: String(poll?.id || uid('poll')).slice(0, 48),
        label: cleanLine(poll?.label, 80),
      }))
      .filter((poll) => poll.label)
      .slice(0, 2);
    const bonsPlans = (Array.isArray(prep.bonsPlans) ? prep.bonsPlans : [])
      .map((plan) => {
        const kind = ['chasseur', 'marche', 'bullseyes', 'custom'].includes(plan?.kind) ? plan.kind : '';
        const addedOn = parseISODate(plan?.addedOn) ? plan.addedOn : '';
        const expiresOn = parseISODate(plan?.expiresOn) ? plan.expiresOn : '';
        if (!kind || !addedOn || !expiresOn || expiresOn < addedOn) return null;
        const preset = PLAN_PRESETS.find((item) => item.kind === kind);
        const label = kind === 'custom' ? cleanLine(plan?.label, 80) : preset.label;
        if (!label) return null;
        return {
          id: String(plan?.id || uid('plan')).slice(0, 48),
          kind,
          label,
          addedOn,
          expiresOn,
        };
      })
      .filter(Boolean);
    const dailyNotes = {};
    if (prep.dailyNotes && typeof prep.dailyNotes === 'object') {
      Object.keys(prep.dailyNotes).forEach((key) => {
        if (!parseISODate(key)) return;
        const note = stripEmoji(String(prep.dailyNotes[key] || '')).slice(0, 500);
        if (note.trim()) dailyNotes[key] = note;
      });
    }
    const drafts = {};
    if (src.drafts && typeof src.drafts === 'object') {
      Object.keys(src.drafts).forEach((key) => {
        const draft = normalizeDraft(src.drafts[key]);
        if (draft) drafts[String(key).slice(0, 80)] = draft;
      });
    }
    return {
      version: 1,
      sharedUpdatedAt: String(src.sharedUpdatedAt || ''),
      sharedUpdatedBy: String(src.sharedUpdatedBy || '').slice(0, 80),
      settings: normalizeSettings(src.settings),
      exceptions: (Array.isArray(src.exceptions) ? src.exceptions : []).map(normalizeException).filter(Boolean),
      prep: {
        date: parseISODate(prep.date) ? prep.date : blank.prep.date,
        vsByDate,
        marshalLevelByDate,
        polls,
        bonsPlans,
        zombiesDores: Boolean(prep.zombiesDores),
        general: Boolean(prep.general),
        svsActive: Boolean(prep.svsActive),
        svsServer: prep.svsActive ? String(prep.svsServer || '').replace(/\D/g, '').slice(0, 6) : '',
        dailyNotes,
      },
      drafts,
    };
  }

  function defaultMarshalTime(iso, settings) {
    return weekday(iso) === 5 ? settings.marshalFridayTime : settings.marshalTime;
  }

  function marshalOccurrence(iso, settings, exceptions) {
    const movedHere = exceptions.filter(
      (item) => item.kind === 'marshal' && item.action === 'move' && item.toDate === iso
    );
    if (movedHere.length) {
      const last = movedHere[movedHere.length - 1];
      return { on: true, time: last.time || defaultMarshalTime(iso, settings) };
    }
    const blocked = exceptions.some(
      (item) => item.kind === 'marshal' && item.date === iso && (item.action === 'cancel' || item.action === 'move')
    );
    if (blocked) return { on: false, time: '' };
    const delta = daysBetween(settings.marshalAnchorDate, iso);
    if (!Number.isFinite(delta) || delta < 0 || delta % 2 !== 0) return { on: false, time: '' };
    return { on: true, time: defaultMarshalTime(iso, settings) };
  }

  function zombieOccurrence(iso, settings, exceptions, marshalOn) {
    const movedHere = exceptions.filter(
      (item) => item.kind === 'zombie' && item.action === 'move' && item.toDate === iso
    );
    if (movedHere.length) {
      const last = movedHere[movedHere.length - 1];
      return {
        on: true,
        time: last.time || (marshalOn ? settings.zombieTimeWithMarshal : settings.zombieTime),
      };
    }
    const blocked = exceptions.some(
      (item) => item.kind === 'zombie' && item.date === iso && (item.action === 'cancel' || item.action === 'move')
    );
    if (blocked) return { on: false, time: '' };
    if (!settings.zombieWeekdays.includes(weekday(iso))) return { on: false, time: '' };
    return { on: true, time: marshalOn ? settings.zombieTimeWithMarshal : settings.zombieTime };
  }

  function eventsForDate(iso, source) {
    const normalized = normalize(source || createBlank());
    const settings = normalized.settings;
    const exceptions = normalized.exceptions;
    const day = weekday(iso);
    const marshal = marshalOccurrence(iso, settings, exceptions);
    const zombie = zombieOccurrence(iso, settings, exceptions, marshal.on);
    return {
      shield: day === 5 || day === 6,
      marshal,
      zombie,
      storm: day === 1 || day === 2 || day === 3,
    };
  }

  function planActiveOn(plan, iso) {
    return Boolean(plan && plan.addedOn <= iso && iso <= plan.expiresOn);
  }

  function purgeExpiredPlans(source, today) {
    const normalized = normalize(source);
    const before = normalized.prep.bonsPlans.length;
    normalized.prep.bonsPlans = normalized.prep.bonsPlans.filter((plan) => plan.expiresOn >= today);
    return { state: normalized, removed: normalized.prep.bonsPlans.length !== before };
  }

  function enforceDraft(text, title, ending) {
    let body = stripEmoji(String(text || '')).replace(/\r\n/g, '\n');
    const end = ending || ENDING;
    if (body.endsWith(end)) body = body.slice(0, -end.length);
    else body = body.replace(/(?:^|\n)Soyez heureux mes préférés !\s*$/g, '');
    body = body.replace(/\n+$/g, '').replace(/^\n+/g, '');
    if (body.startsWith(title)) body = body.slice(title.length).replace(/^\n/, '');
    else body = body.replace(/^Programme du [^\n]*\n?/, '');
    const middle = body.replace(/^\n+|\n+$/g, '');
    if (!middle) return `${title}\n${end}`;
    return `${title}\n${middle}\n${end}`;
  }

  function canCopy(text, title, ending) {
    const value = String(text || '');
    if (!value || value.length > MAX_CHARS) return false;
    if (hasEmoji(value)) return false;
    if (!value.startsWith(title)) return false;
    if (!value.endsWith(ending || ENDING)) return false;
    return true;
  }

  function joinFr(items) {
    const list = items.filter(Boolean);
    if (list.length <= 1) return list[0] || '';
    if (list.length === 2) return `${list[0]} et ${list[1]}`;
    return `${list.slice(0, -1).join(', ')} et ${list[list.length - 1]}`;
  }

  function planPlainName(plan) {
    if (!plan) return '';
    if (plan.kind === 'chasseur') return 'Chasseur de primes';
    if (plan.kind === 'marche') return 'Marché scintillant';
    if (plan.kind === 'bullseyes') return 'Butin de BullEyes';
    return cleanLine(plan.label, 80).replace(/[.!?]+$/g, '');
  }

  function sentence(label, full, short) {
    return { label, full: full || '', short: short && short.length < (full || '').length ? short : full || '' };
  }

  function composeMessage(title, shield, blocks, shortened, withGreeting) {
    const lines = [title];
    if (shield) lines.push(SHIELD);
    if (withGreeting) lines.push(GREETING);
    blocks.forEach((block) => {
      lines.push(shortened.has(block.label) ? block.short : block.full);
    });
    lines.push(ENDING);
    return lines.join('\n');
  }

  function generateNotification(source, date) {
    const normalized = normalize(source);
    const iso = parseISODate(date) ? date : normalized.prep.date;
    const title = formatTitle(iso);
    const events = eventsForDate(iso, normalized);
    const prep = normalized.prep;
    const warnings = [];
    const pending = [];
    const vs = prep.vsByDate[iso] || '';
    if (vs === 'fond') {
      pending.push(sentence('VS', PHRASES.vsFond, 'On donne tout pour le VS !'));
    } else if (vs === 'economie') {
      pending.push(
        sentence('VS', PHRASES.vsEco, 'Journée économique au VS : gardez vos ressources !')
      );
    } else if (vs === '72m') {
      pending.push(sentence('VS', PHRASES.vs72, 'Visez les 7,2 millions de points au VS !'));
    } else pending.push(sentence('VS (non choisi)', '', ''));

    if (events.marshal.on) {
      const level = prep.marshalLevelByDate[iso] || '';
      const time = formatHeure(events.marshal.time);
      if (!level) warnings.push('Niveau du Maréchal non indiqué.');
      pending.push(
        level
          ? sentence(
              'Maréchal',
              `Rendez-vous à ${time} pour le Maréchal niveau ${level} !`,
              `Maréchal niveau ${level} à ${time}.`
            )
          : sentence('Maréchal', `Rendez-vous à ${time} pour le Maréchal !`, `Maréchal à ${time}.`)
      );
    }
    if (events.zombie.on) {
      const time = formatHeure(events.zombie.time);
      pending.push(
        sentence('Zombies', `On se retrouve à ${time} pour les Zombies !`, `Zombies à ${time}.`)
      );
    }
    if (events.storm) {
      pending.push(
        sentence(
          'Tempête du désert',
          PHRASES.storm,
          'Inscrivez-vous à la Tempête du désert et indiquez vos disponibilités.'
        )
      );
    }
    if (prep.polls.length) {
      const labels = prep.polls.map((poll) => poll.label.replace(/[.!?]+$/g, ''));
      const list = joinFr(labels);
      const singular = labels.length === 1;
      pending.push(
        sentence(
          `Sondage : ${list}`,
          singular
            ? `N'oubliez pas de répondre au sondage ${list} !`
            : `N'oubliez pas de répondre aux sondages ${list} !`,
          singular ? `Répondez au sondage ${list}.` : `Sondages : ${list}.`
        )
      );
    }
    const activePlans = prep.bonsPlans.filter((plan) => planActiveOn(plan, iso));
    if (activePlans.length) {
      const names = activePlans.map(planPlainName);
      const withArticle = activePlans.map((plan) =>
        plan.kind === 'custom' ? `de ${planPlainName(plan)}` : `du ${planPlainName(plan)}`
      );
      pending.push(
        sentence(
          names.join(', '),
          `Profitez ${joinFr(withArticle)} dans les Bons plans !`,
          `Bons plans : ${joinFr(names)}.`
        )
      );
    }
    if (prep.zombiesDores) {
      pending.push(
        sentence('Zombies dorés', PHRASES.gold, 'Zombies dorés : laissez 10 minutes au découvreur pour le Boss.')
      );
    }
    if (prep.general) {
      pending.push(sentence('Le Général', PHRASES.general, 'Général : montez quand vous réussissez seuls 80 % du niveau précédent.'));
    }
    if (prep.svsActive) {
      if (!prep.svsServer) pending.push(sentence('SVS (numéro manquant)', '', ''));
      else {
        pending.push(
          sentence(
            'SVS',
            `C'est le moment du SVS : pillez le serveur ${prep.svsServer} !`,
            `SVS : pillez le serveur ${prep.svsServer}.`
          )
        );
      }
    }
    const note = stripEmoji(prep.dailyNotes[iso] || '')
      .trim()
      .replace(/^Programme du [^\n]*\n?/, '')
      .replace(/\n?Soyez heureux mes préférés !\s*$/g, '')
      .trim();
    if (note) {
      const punctuated = /[.!?]$/.test(note) ? note : `${note}.`;
      pending.push(sentence('Consigne exceptionnelle', punctuated, punctuated));
    }

    const omitted = [];
    const ready = [];
    pending.forEach((block) => {
      if (!block.full) omitted.push({ label: block.label, text: '' });
      else ready.push(block);
    });

    const shortened = new Set();
    let withGreeting = true;
    let text = composeMessage(title, events.shield, ready, shortened, withGreeting);
    if (text.length > MAX_CHARS) {
      const candidates = ready
        .filter((block) => block.short !== block.full)
        .sort((a, b) => b.full.length - b.short.length - (a.full.length - a.short.length));
      candidates.forEach((block) => {
        if (text.length <= MAX_CHARS) return;
        shortened.add(block.label);
        text = composeMessage(title, events.shield, ready, shortened, withGreeting);
      });
    }
    if (text.length > MAX_CHARS) {
      withGreeting = false;
      text = composeMessage(title, events.shield, ready, shortened, withGreeting);
      omitted.push({ label: 'Coucou les ROS6', text: GREETING });
    }
    if (shortened.size) {
      warnings.push('Certaines phrases ont été raccourcies pour rester sous 500 caractères.');
    }
    const kept = ready.slice();
    while (kept.length && composeMessage(title, events.shield, kept, shortened, withGreeting).length > MAX_CHARS) {
      omitted.push(kept.pop());
    }
    text = composeMessage(title, events.shield, kept, shortened, withGreeting);
    return {
      text,
      omitted,
      warnings,
      title,
      ending: ENDING,
    };
  }

  function mergeDrafts(remoteDrafts, localDrafts) {
    const out = {};
    const keys = new Set([...Object.keys(remoteDrafts || {}), ...Object.keys(localDrafts || {})]);
    keys.forEach((key) => {
      const remote = remoteDrafts?.[key];
      const local = localDrafts?.[key];
      if (!remote) out[key] = clone(local);
      else if (!local) out[key] = clone(remote);
      else out[key] = String(local.updatedAt || '') >= String(remote.updatedAt || '') ? clone(local) : clone(remote);
    });
    return out;
  }

  function mergeStores(remote, local) {
    if (local == null) return remote == null ? null : normalize(remote);
    if (remote == null) return normalize(local);
    const remoteState = normalize(remote);
    const localState = normalize(local);
    const useLocal = String(localState.sharedUpdatedAt || '') >= String(remoteState.sharedUpdatedAt || '');
    const shared = useLocal ? localState : remoteState;
    return normalize({
      version: 1,
      sharedUpdatedAt: shared.sharedUpdatedAt,
      sharedUpdatedBy: shared.sharedUpdatedBy,
      settings: shared.settings,
      exceptions: shared.exceptions,
      prep: shared.prep,
      drafts: mergeDrafts(remoteState.drafts, localState.drafts),
    });
  }

  function currentUserId() {
    try {
      const session = global.ROSSync && typeof ROSSync.getSession === 'function' ? ROSSync.getSession() : null;
      if (session?.user?.id) return String(session.user.id);
    } catch (error) {
      /* ignore */
    }
    try {
      const profile =
        global.ROSProfiles && typeof ROSProfiles.getCurrentProfile === 'function'
          ? ROSProfiles.getCurrentProfile()
          : null;
      if (profile?.userId) return String(profile.userId);
    } catch (error) {
      /* ignore */
    }
    return 'local';
  }

  function canAccess() {
    if (global.ROSProfiles && typeof ROSProfiles.isActiveR4OrR5 === 'function') {
      return Boolean(ROSProfiles.isActiveR4OrR5());
    }
    let role = 'R4';
    try {
      role = global.ROSStorage ? ROSStorage.getState()?.appRole || 'R4' : 'R4';
    } catch (error) {
      role = 'R4';
    }
    return role === 'R4' || role === 'R5';
  }

  function toast(message) {
    if (global.AppUI && typeof AppUI.toast === 'function') AppUI.toast(message);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        state = createBlank();
        return state;
      }
      state = normalize(JSON.parse(raw));
      return state;
    } catch (error) {
      state = createBlank();
      return state;
    }
  }

  function write() {
    if (!state) state = createBlank();
    state = normalize(state);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if (global.ROSSync && typeof ROSSync.schedulePush === 'function') {
      ROSSync.schedulePush(STORAGE_KEY);
    }
  }

  function ensureState() {
    if (!state) loadState();
    return state;
  }

  function touchShared(mutator) {
    ensureState();
    const mine = currentUserId();
    if (
      seenSharedAt &&
      state.sharedUpdatedAt &&
      state.sharedUpdatedAt !== seenSharedAt &&
      state.sharedUpdatedBy &&
      state.sharedUpdatedBy !== mine
    ) {
      toast('Préparation commune mise à jour par un autre R4. Modification non appliquée.');
      remoteSharedChanged = true;
      render(true);
      return false;
    }
    mutator(state);
    const now = new Date().toISOString();
    state.sharedUpdatedAt = now;
    state.sharedUpdatedBy = mine;
    seenSharedAt = now;
    write();
    return true;
  }

  function clearTimers() {
    Object.keys(timers).forEach((key) => {
      clearTimeout(timers[key]);
      delete timers[key];
    });
  }

  function debounce(key, fn, ms) {
    clearTimeout(timers[key]);
    timers[key] = setTimeout(() => {
      delete timers[key];
      fn();
    }, ms);
  }

  function sharedStamp() {
    ensureState();
    return JSON.stringify({
      at: state.sharedUpdatedAt,
      settings: state.settings,
      exceptions: state.exceptions,
      prep: state.prep,
    });
  }

  function currentDraft() {
    ensureState();
    return state.drafts[currentUserId()] || null;
  }

  function saveDraft(text, forDate) {
    ensureState();
    const id = currentUserId();
    const prev = state.drafts[id] || {};
    state.drafts[id] = {
      text,
      updatedAt: new Date().toISOString(),
      forDate,
      omitted: prev.forDate === forDate && Array.isArray(prev.omitted) ? prev.omitted : [],
      warnings: prev.forDate === forDate && Array.isArray(prev.warnings) ? prev.warnings : [],
    };
    write();
  }

  function ensurePrepDate() {
    ensureState();
    if (parseISODate(state.prep.date)) return;
    const today = parisToday();
    touchShared((current) => {
      current.prep.date = today;
    });
  }

  function updateDraftChrome(text, title) {
    const countEl = document.getElementById('museCount');
    const copyBtn = document.getElementById('museCopy');
    const length = String(text || '').length;
    const over = length > MAX_CHARS;
    if (countEl) {
      countEl.textContent = over
        ? `${length} / ${MAX_CHARS} — au-delà de 500 caractères`
        : `${length} / ${MAX_CHARS}`;
      countEl.classList.toggle('is-over', over);
    }
    if (copyBtn) copyBtn.disabled = !canCopy(text, title, ENDING);
  }

  function autoList(iso) {
    const events = eventsForDate(iso, state);
    const rows = [
      events.shield ? 'Bouclier : juste après le titre.' : 'Bouclier : non.',
      events.marshal.on ? `Maréchal : ${formatHeure(events.marshal.time)}.` : 'Maréchal : non.',
      events.zombie.on ? `Zombies : ${formatHeure(events.zombie.time)}.` : 'Zombies : non.',
      events.storm
        ? 'Tempête du désert : inscriptions et disponibilités.'
        : 'Tempête du désert : pas de rappel.',
    ];
    return `<ul class="muse-auto">${rows.map((row) => `<li>${escapeHtml(row)}</li>`).join('')}</ul>`;
  }

  function wizardHtml() {
    const date = state.prep.date;
    const events = eventsForDate(date, state);
    const vs = state.prep.vsByDate[date] || '';
    const level = state.prep.marshalLevelByDate[date] || '';
    const note = state.prep.dailyNotes[date] || '';
    const draft = currentDraft();
    const draftText = draft && draft.forDate === date ? draft.text : '';
    const omitted = draft && draft.forDate === date ? draft.omitted : [];
    const warnings = draft && draft.forDate === date ? draft.warnings : [];
    const steps = STEP_LABELS.map(
      (label, index) =>
        `<button type="button" class="muse-step${step === index + 1 ? ' is-active' : ''}" data-muse-action="step" data-muse-step="${index + 1}">${index + 1}. ${escapeHtml(label)}</button>`
    ).join('');
    let body = '';
    if (step === 1) {
      body = `
        <label class="field">
          <span>Date de la notification</span>
          <input type="date" id="museDate" class="input" value="${escapeHtml(date)}" />
        </label>
        ${autoList(date)}
        <p class="panel-subtitle">Ces événements suivent les règles et les exceptions. Rien n’est inventé.</p>`;
    } else if (step === 2) {
      body = `
        <div class="muse-choice">
          <label><input type="radio" name="museVs" value="fond"${vs === 'fond' ? ' checked' : ''} /> À fond — ${escapeHtml(PHRASES.vsFond)}</label>
          <label><input type="radio" name="museVs" value="economie"${vs === 'economie' ? ' checked' : ''} /> Économie — ${escapeHtml(PHRASES.vsEco)}</label>
          <label><input type="radio" name="museVs" value="72m"${vs === '72m' ? ' checked' : ''} /> 7,2 M — ${escapeHtml(PHRASES.vs72)}</label>
        </div>
        <p class="panel-subtitle">Un seul choix pour cette date. Le VS n’est pas le SVS.</p>`;
    } else if (step === 3) {
      body = events.marshal.on
        ? `
          <p>Maréchal prévu à ${escapeHtml(formatHeure(events.marshal.time))} (heure de Paris).</p>
          <label class="field">
            <span>Niveau du Maréchal</span>
            <input type="number" id="museLevel" class="input" min="1" max="200" step="1" inputmode="numeric" value="${escapeHtml(level)}" />
          </label>`
        : `<p>Pas de Maréchal à cette date. Le niveau n’est pas demandé.</p>`;
    } else if (step === 4) {
      const polls = state.prep.polls
        .map(
          (poll) =>
            `<li><span>${escapeHtml(poll.label)}</span><button type="button" class="btn btn-danger btn-sm" data-muse-action="delete-poll" data-muse-id="${escapeHtml(poll.id)}">Retirer</button></li>`
        )
        .join('');
      const activePlans = state.prep.bonsPlans.filter((plan) => planActiveOn(plan, date));
      const plans = activePlans
        .map(
          (plan) =>
            `<li><span>${escapeHtml(plan.label)} — jusqu’au ${escapeHtml(formatDateFr(plan.expiresOn, true))}</span><button type="button" class="btn btn-danger btn-sm" data-muse-action="delete-plan" data-muse-id="${escapeHtml(plan.id)}">Retirer</button></li>`
        )
        .join('');
      const presets = PLAN_PRESETS.map((preset) => {
        const taken = activePlans.some((plan) => plan.kind === preset.kind);
        return `<button type="button" class="btn btn-ghost btn-sm" data-muse-action="add-plan" data-muse-kind="${preset.kind}" ${taken ? 'disabled' : ''}>${escapeHtml(preset.label)}</button>`;
      }).join('');
      body = `
        ${weekday(date) === 1 ? '<p class="muse-note">Lundi : y a-t-il des événements particuliers cette semaine ?</p>' : ''}
        <h3>Sondages</h3>
        <ul class="muse-list">${polls || '<li>Aucun sondage.</li>'}</ul>
        ${
          state.prep.polls.length < 2
            ? `<div class="muse-inline"><input id="musePollLabel" class="input" maxlength="80" placeholder="Intitulé du sondage" /><button type="button" class="btn btn-primary btn-sm" data-muse-action="add-poll">Ajouter</button></div>`
            : '<p class="panel-subtitle">Deux sondages au maximum.</p>'
        }
        <h3>Bons plans</h3>
        <p class="panel-subtitle">Actifs jusqu’au dimanche inclus, puis retirés. Suppression anticipée possible.</p>
        <div class="muse-inline">${presets}</div>
        <div class="muse-inline">
          <input id="musePlanCustom" class="input" maxlength="80" placeholder="Événement personnalisé" />
          <button type="button" class="btn btn-ghost btn-sm" data-muse-action="add-custom-plan">Ajouter</button>
        </div>
        <ul class="muse-list">${plans || '<li>Aucun bon plan actif à cette date.</li>'}</ul>
        <h3>Événements manuels</h3>
        <label class="muse-check"><input type="checkbox" id="museGold"${state.prep.zombiesDores ? ' checked' : ''} /> Zombies dorés</label>
        <p class="panel-subtitle">${escapeHtml(PHRASES.gold)}</p>
        <label class="muse-check"><input type="checkbox" id="museGeneral"${state.prep.general ? ' checked' : ''} /> Le Général</label>
        <p class="panel-subtitle">${escapeHtml(PHRASES.general)}</p>
        <label class="muse-check"><input type="checkbox" id="museSvs"${state.prep.svsActive ? ' checked' : ''} /> SVS</label>
        ${
          state.prep.svsActive
            ? `<label class="field"><span>Numéro du serveur à piller</span><input id="museSvsServer" class="input" inputmode="numeric" maxlength="6" value="${escapeHtml(state.prep.svsServer)}" /></label>`
            : ''
        }
        <p class="panel-subtitle">Le SVS reste distinct du VS. Le numéro est conservé jusqu’à la désactivation.</p>`;
    } else if (step === 5) {
      body = `
        <label class="field">
          <span>Consigne exceptionnelle</span>
          <textarea id="museDaily" class="input muse-editor" rows="4">${escapeHtml(note)}</textarea>
        </label>
        <p class="panel-subtitle">Ce champ est vide pour une nouvelle date. Il n’est pas recopié le lendemain.</p>`;
    } else {
      const title = formatTitle(date);
      const over = draftText.length > MAX_CHARS;
      body = `
        <button type="button" class="btn btn-primary" id="museGenerate" data-muse-action="generate">Générer la notification</button>
        ${
          draftText
            ? `<label class="field"><span>Votre texte — il ne remplace pas celui d’un autre R4</span><textarea id="museDraft" class="input muse-editor" rows="12" data-muse-date="${escapeHtml(date)}">${escapeHtml(draftText)}</textarea></label>
              <p id="museCount" class="muse-count${over ? ' is-over' : ''}" aria-live="polite">${draftText.length} / ${MAX_CHARS}${over ? ' — au-delà de 500 caractères' : ''}</p>
              ${warnings.length ? `<div class="muse-note">${warnings.map((item) => `<p>${escapeHtml(item)}</p>`).join('')}</div>` : ''}
              ${omitted.length ? `<div class="muse-alert" role="status"><p>Non inclus dans la notification :</p><ul>${omitted.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></div>` : ''}
              <button type="button" class="btn btn-primary" id="museCopy" data-muse-action="copy"${canCopy(draftText, title, ENDING) ? '' : ' disabled'}>Copier</button>`
            : '<p class="panel-subtitle">Après génération, le texte s’ouvre dans votre espace. Aucun historique n’est conservé.</p>'
        }`;
    }
    return `
      <div data-muse-ready="1">
        <div class="muse-steps" role="tablist">${steps}</div>
        <div class="muse-body">${body}</div>
        <div class="muse-nav">
          ${step > 1 ? '<button type="button" class="btn btn-ghost" data-muse-action="prev">Précédent</button>' : ''}
          ${step < 6 ? '<button type="button" class="btn btn-primary" data-muse-action="next">Suivant</button>' : ''}
        </div>
      </div>`;
  }

  function settingsHtml() {
    const settings = state.settings;
    const days = WEEKDAYS.map((label, index) => {
      const checked = settings.zombieWeekdays.includes(index) ? ' checked' : '';
      return `<label class="muse-check"><input type="checkbox" data-muse-day="${index}"${checked} /> ${label}</label>`;
    }).join('');
    const exceptions = state.exceptions
      .map((item) => {
        const kind = item.kind === 'marshal' ? 'Maréchal' : 'Zombies';
        const text =
          item.action === 'cancel'
            ? `${kind} annulé le ${formatDateFr(item.date, true)}`
            : `${kind} déplacé du ${formatDateFr(item.date, true)} au ${formatDateFr(item.toDate, true)}${item.time ? ` à ${formatHeure(item.time)}` : ''}`;
        return `<li><span>${escapeHtml(text)}</span><button type="button" class="btn btn-danger btn-sm" data-muse-action="delete-exception" data-muse-id="${escapeHtml(item.id)}">Retirer</button></li>`;
      })
      .join('');
    const upcoming = [];
    const start = parseISODate(state.prep.date) ? state.prep.date : parisToday();
    for (let i = 0; i < 14; i += 1) {
      const date = addDays(start, i);
      const events = eventsForDate(date, state);
      if (!events.marshal.on && !events.zombie.on) continue;
      const bits = [];
      if (events.marshal.on) bits.push(`Maréchal ${formatHeure(events.marshal.time)}`);
      if (events.zombie.on) bits.push(`Zombies ${formatHeure(events.zombie.time)}`);
      upcoming.push(`<li>${escapeHtml(formatDateFr(date, true))} — ${escapeHtml(bits.join(' · '))}</li>`);
    }
    return `
      <div data-muse-ready="1" class="muse-settings">
        <p class="panel-subtitle">Ces réglages recalculent les prochaines dates. Une exception ne change pas la règle permanente.</p>
        <div class="muse-settings-grid">
          <label class="field"><span>Date de référence du Maréchal</span><input type="date" id="museAnchor" class="input" value="${escapeHtml(settings.marshalAnchorDate)}" /></label>
          <label class="field"><span>Horaire habituel du Maréchal</span><input type="time" id="museMarshalTime" class="input" value="${escapeHtml(settings.marshalTime)}" /></label>
          <label class="field"><span>Horaire du vendredi</span><input type="time" id="museFridayTime" class="input" value="${escapeHtml(settings.marshalFridayTime)}" /></label>
          <label class="field"><span>Zombies sans Maréchal</span><input type="time" id="museZombieTime" class="input" value="${escapeHtml(settings.zombieTime)}" /></label>
          <label class="field"><span>Zombies avec Maréchal</span><input type="time" id="museZombieWith" class="input" value="${escapeHtml(settings.zombieTimeWithMarshal)}" /></label>
        </div>
        <fieldset class="muse-days"><legend>Jours des Zombies</legend>${days}</fieldset>
        <h3>Exception ponctuelle</h3>
        <div class="muse-settings-grid">
          <label class="field"><span>Événement</span><select id="museExKind" class="input"><option value="marshal">Maréchal</option><option value="zombie">Zombies</option></select></label>
          <label class="field"><span>Date prévue</span><input type="date" id="museExDate" class="input" /></label>
          <label class="field"><span>Action</span><select id="museExAction" class="input"><option value="cancel">Annuler</option><option value="move">Déplacer</option></select></label>
          <label class="field"><span>Nouvelle date</span><input type="date" id="museExTo" class="input" /></label>
          <label class="field"><span>Nouvelle heure</span><input type="time" id="museExTime" class="input" /></label>
        </div>
        <button type="button" class="btn btn-primary btn-sm" data-muse-action="add-exception">Enregistrer l’exception</button>
        <ul class="muse-list">${exceptions || '<li>Aucune exception.</li>'}</ul>
        <h3>14 prochains jours</h3>
        <ul class="muse-auto">${upcoming.join('') || '<li>Aucun Maréchal ni Zombies.</li>'}</ul>
      </div>`;
  }

  function render(force) {
    if (painting) return;
    const panel = document.getElementById('panel-muse');
    const root = document.getElementById('museRoot');
    if (!panel || !root) return;
    if (panel.hidden) {
      paintKey = '';
      return;
    }
    painting = true;
    try {
    bind();
    const toggle = document.getElementById('museToggleSettings');
    if (!canAccess()) {
      root.innerHTML = '<p class="empty-state">La Muse est réservée aux R4 et R5.</p>';
      if (toggle) toggle.hidden = true;
      paintKey = 'denied';
      return;
    }
    if (toggle) {
      toggle.hidden = false;
      toggle.textContent = view === 'settings' ? 'Retour à la préparation' : 'Paramètres';
    }
    ensureState();
    ensurePrepDate();
    const hard = Boolean(force || remoteSharedChanged);
    remoteSharedChanged = false;
    const focused = document.activeElement;
    const typing =
      !hard &&
      focused &&
      root.contains(focused) &&
      (focused.tagName === 'INPUT' || focused.tagName === 'TEXTAREA' || focused.tagName === 'SELECT');
    if (typing) return;
    const key = `${view}:${step}:${sharedStamp()}`;
    if (!hard && key === paintKey && root.querySelector('[data-muse-ready]')) return;
    paintKey = key;
    root.innerHTML = view === 'settings' ? settingsHtml() : wizardHtml();
    } finally {
      painting = false;
    }
  }

  function flushPendingInputs() {
    if (!state) return;
    if (timers.daily) {
      clearTimeout(timers.daily);
      delete timers.daily;
      const daily = document.getElementById('museDaily');
      if (daily) {
        const date = state.prep.date;
        const text = stripEmoji(daily.value).slice(0, 500);
        touchShared((current) => {
          current.prep.dailyNotes[date] = text;
        });
      }
    }
    if (timers.level) {
      clearTimeout(timers.level);
      delete timers.level;
      const levelEl = document.getElementById('museLevel');
      if (levelEl) {
        const date = state.prep.date;
        const level = String(levelEl.value || '').replace(/\D/g, '').slice(0, 3);
        touchShared((current) => {
          if (level) current.prep.marshalLevelByDate[date] = level;
          else delete current.prep.marshalLevelByDate[date];
        });
      }
    }
    if (timers.svs) {
      clearTimeout(timers.svs);
      delete timers.svs;
      const serverEl = document.getElementById('museSvsServer');
      if (serverEl) {
        const server = String(serverEl.value || '').replace(/\D/g, '').slice(0, 6);
        touchShared((current) => {
          current.prep.svsServer = server;
        });
      }
    }
    if (timers.draft) {
      clearTimeout(timers.draft);
      delete timers.draft;
      const draftEl = document.getElementById('museDraft');
      if (draftEl) {
        const date = draftEl.dataset.museDate || state.prep.date;
        saveDraft(enforceDraft(draftEl.value, formatTitle(date), ENDING), date);
      }
    }
  }

  function setStep(next) {
    flushPendingInputs();
    step = Math.min(6, Math.max(1, next));
    view = 'wizard';
    render(true);
  }

  function addPoll() {
    const input = document.getElementById('musePollLabel');
    const label = cleanLine(input ? input.value : '', 80);
    if (!label) {
      toast('Indiquez l’intitulé du sondage.');
      return;
    }
    if (hasEmoji(input?.value || '')) {
      toast('Les emojis ne sont pas autorisés.');
      return;
    }
    if (state.prep.polls.length >= 2) {
      toast('Deux sondages maximum.');
      return;
    }
    const ok = touchShared((current) => {
      if (current.prep.polls.length >= 2) return;
      current.prep.polls.push({ id: uid('poll'), label });
    });
    if (ok) render(true);
  }

  function addPlan(kind, label) {
    const date = state.prep.date;
    if (!parseISODate(date)) return;
    const clean = kind === 'custom' ? cleanLine(label, 80) : PLAN_PRESETS.find((item) => item.kind === kind)?.label || '';
    if (!clean) {
      toast('Indiquez l’événement.');
      return;
    }
    if (kind !== 'custom' && state.prep.bonsPlans.some((plan) => plan.kind === kind && planActiveOn(plan, date))) {
      toast('Cet événement est déjà actif.');
      return;
    }
    const ok = touchShared((current) => {
      current.prep.bonsPlans.push({
        id: uid('plan'),
        kind,
        label: clean,
        addedOn: date,
        expiresOn: sundayOnOrAfter(date),
      });
    });
    if (ok) render(true);
  }

  function addException() {
    const kind = document.getElementById('museExKind')?.value === 'zombie' ? 'zombie' : 'marshal';
    const date = document.getElementById('museExDate')?.value || '';
    const action = document.getElementById('museExAction')?.value === 'move' ? 'move' : 'cancel';
    const toDate = document.getElementById('museExTo')?.value || '';
    const time = validTime(document.getElementById('museExTime')?.value || '');
    if (!parseISODate(date)) {
      toast('Indiquez la date prévue.');
      return;
    }
    if (state.exceptions.some((item) => item.kind === kind && item.date === date)) {
      toast('Une exception existe déjà pour cette date. Retirez-la d’abord.');
      return;
    }
    const events = eventsForDate(date, state);
    const active = kind === 'marshal' ? events.marshal.on : events.zombie.on;
    if (!active) {
      toast(kind === 'marshal' ? 'Aucun Maréchal à cette date.' : 'Aucun Zombies à cette date.');
      return;
    }
    if (action === 'move' && (!parseISODate(toDate) || toDate === date)) {
      toast('Indiquez une autre date.');
      return;
    }
    const item = { id: uid('ex'), kind, action, date };
    if (action === 'move') {
      item.toDate = toDate;
      if (time) item.time = time;
    }
    const ok = touchShared((current) => {
      current.exceptions.push(item);
    });
    if (ok) render(true);
  }

  function onClick(event) {
    const button = event.target.closest('[data-muse-action]');
    if (!button || button.disabled) return;
    const action = button.dataset.museAction;
    if (action === 'step') setStep(Number(button.dataset.museStep));
    else if (action === 'next') setStep(step + 1);
    else if (action === 'prev') setStep(step - 1);
    else if (action === 'add-poll') addPoll();
    else if (action === 'delete-poll') {
      const id = button.dataset.museId;
      if (touchShared((current) => {
        current.prep.polls = current.prep.polls.filter((poll) => poll.id !== id);
      })) render(true);
    } else if (action === 'add-plan') addPlan(button.dataset.museKind, '');
    else if (action === 'add-custom-plan') {
      const input = document.getElementById('musePlanCustom');
      if (hasEmoji(input?.value || '')) {
        toast('Les emojis ne sont pas autorisés.');
        return;
      }
      addPlan('custom', input ? input.value : '');
    } else if (action === 'delete-plan') {
      const id = button.dataset.museId;
      if (touchShared((current) => {
        current.prep.bonsPlans = current.prep.bonsPlans.filter((plan) => plan.id !== id);
      })) render(true);
    } else if (action === 'add-exception') addException();
    else if (action === 'delete-exception') {
      const id = button.dataset.museId;
      if (touchShared((current) => {
        current.exceptions = current.exceptions.filter((item) => item.id !== id);
      })) render(true);
    } else if (action === 'generate') generateCurrent();
    else if (action === 'copy') void copyCurrent();
  }

  function onChange(event) {
    const target = event.target;
    if (!target) return;
    if (target.id === 'museDate' && parseISODate(target.value)) {
      touchShared((current) => {
        current.prep.date = target.value;
      });
      render(true);
      return;
    }
    if (target.name === 'museVs') {
      const date = state.prep.date;
      const mode = target.value;
      if (mode !== 'fond' && mode !== 'economie' && mode !== '72m') return;
      touchShared((current) => {
        current.prep.vsByDate[date] = mode;
      });
      return;
    }
    if (target.id === 'museGold' || target.id === 'museGeneral' || target.id === 'museSvs') {
      touchShared((current) => {
        if (target.id === 'museGold') current.prep.zombiesDores = target.checked;
        if (target.id === 'museGeneral') current.prep.general = target.checked;
        if (target.id === 'museSvs') {
          current.prep.svsActive = target.checked;
          if (!target.checked) current.prep.svsServer = '';
        }
      });
      if (target.id === 'museSvs') render(true);
      return;
    }
    if (target.dataset.museDay != null) {
      const days = Array.from(document.querySelectorAll('[data-muse-day]:checked')).map((input) =>
        Number(input.dataset.museDay)
      );
      touchShared((current) => {
        current.settings.zombieWeekdays = days;
      });
      render(true);
      return;
    }
    if (target.id === 'museAnchor' && parseISODate(target.value)) {
      touchShared((current) => {
        current.settings.marshalAnchorDate = target.value;
      });
      render(true);
      return;
    }
    const timeMap = {
      museMarshalTime: 'marshalTime',
      museFridayTime: 'marshalFridayTime',
      museZombieTime: 'zombieTime',
      museZombieWith: 'zombieTimeWithMarshal',
    };
    if (timeMap[target.id]) {
      const time = validTime(target.value);
      if (!time) return;
      const field = timeMap[target.id];
      touchShared((current) => {
        current.settings[field] = time;
      });
      render(true);
    }
  }

  function onInput(event) {
    const target = event.target;
    if (!target) return;
    if (target.id === 'museLevel') {
      debounce('level', () => {
        const date = state.prep.date;
        const level = String(target.value || '').replace(/\D/g, '').slice(0, 3);
        touchShared((current) => {
          if (level) current.prep.marshalLevelByDate[date] = level;
          else delete current.prep.marshalLevelByDate[date];
        });
      }, 250);
      return;
    }
    if (target.id === 'museDaily') {
      debounce('daily', () => {
        const date = state.prep.date;
        const text = stripEmoji(target.value).slice(0, 500);
        if (text !== target.value) target.value = text;
        touchShared((current) => {
          current.prep.dailyNotes[date] = text;
        });
      }, 250);
      return;
    }
    if (target.id === 'museSvsServer') {
      debounce('svs', () => {
        const server = String(target.value || '').replace(/\D/g, '').slice(0, 6);
        touchShared((current) => {
          current.prep.svsServer = server;
        });
      }, 250);
      return;
    }
    if (target.id === 'museDraft') {
      const date = target.dataset.museDate || state.prep.date;
      const title = formatTitle(date);
      const next = enforceDraft(target.value, title, ENDING);
      if (next !== target.value) {
        const pos = target.selectionStart || 0;
        target.value = next;
        const caret = Math.max(0, Math.min(pos, next.length));
        if (typeof target.setSelectionRange === 'function') target.setSelectionRange(caret, caret);
      }
      updateDraftChrome(next, title);
      debounce('draft', () => saveDraft(next, date), 250);
    }
  }

  function onKeyDown(event) {
    if (event.key === 'Enter' && event.target?.id === 'musePollLabel') {
      event.preventDefault();
      addPoll();
    }
  }

  function generateCurrent() {
    flushPendingInputs();
    ensureState();
    const date = state.prep.date;
    if (!parseISODate(date)) return;
    const result = generateNotification(state, date);
    state.drafts[currentUserId()] = {
      text: result.text,
      updatedAt: new Date().toISOString(),
      forDate: date,
      omitted: result.omitted.map((item) => item.label),
      warnings: result.warnings.slice(),
    };
    write();
    render(true);
  }

  async function copyCurrent() {
    const field = document.getElementById('museDraft');
    if (!field) return;
    const date = field.dataset.museDate || state.prep.date;
    const title = formatTitle(date);
    const text = enforceDraft(field.value, title, ENDING);
    field.value = text;
    updateDraftChrome(text, title);
    saveDraft(text, date);
    if (!canCopy(text, title, ENDING)) {
      toast(
        text.length > MAX_CHARS
          ? '500 caractères maximum, titre et espaces compris.'
          : 'Le titre et la phrase finale doivent rester, sans emoji.'
      );
      return;
    }
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(text);
      } else {
        field.focus();
        field.select();
        document.execCommand('copy');
      }
      toast('Notification copiée.');
    } catch (error) {
      toast('Copie impossible depuis ce navigateur.');
    }
  }

  function bind() {
    const root = document.getElementById('museRoot');
    if (!root || bound) return;
    bound = true;
    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);
    root.addEventListener('input', onInput);
    root.addEventListener('keydown', onKeyDown);
    document.getElementById('museToggleSettings')?.addEventListener('click', () => {
      if (!canAccess()) return;
      view = view === 'settings' ? 'wizard' : 'settings';
      render(true);
    });
  }

  function init() {
    if (typeof document === 'undefined') return;
    if (!state) {
      loadState();
      seenSharedAt = state.sharedUpdatedAt || '';
    }
    bind();
  }

  function hydrateFromStorage() {
    clearTimers();
    const previous = seenSharedAt;
    loadState();
    remoteSharedChanged = Boolean(
      previous &&
        state.sharedUpdatedAt &&
        state.sharedUpdatedAt !== previous &&
        state.sharedUpdatedBy !== currentUserId()
    );
    seenSharedAt = state.sharedUpdatedAt || '';
    if (remoteSharedChanged) toast('Préparation commune mise à jour par un autre R4.');
  }

  function renderPublic() {
    render(false);
  }

  global.MuseModule = {
    STORAGE_KEY,
    init,
    render: renderPublic,
    hydrateFromStorage,
    canAccess,
    mergeStores,
    __test: {
      createBlank,
      normalize,
      eventsForDate,
      generateNotification,
      mergeStores,
      enforceDraft,
      canCopy,
      hasEmoji,
      stripEmoji,
      sundayOnOrAfter,
      planActiveOn,
      purgeExpiredPlans,
      formatTitle,
      formatHeure,
      parisToday,
      addDays,
      weekday,
      ENDING,
      SHIELD,
      PHRASES,
      MAX_CHARS,
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
