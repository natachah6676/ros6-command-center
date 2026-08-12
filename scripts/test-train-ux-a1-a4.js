/**
 * Vérifie les améliorations UX Train A1–A4 (sans changer les règles métier).
 * node scripts/test-train-ux-a1-a4.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const train = fs.readFileSync(path.join(root, 'js/train.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css/styles.css'), 'utf8');

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) {
    passed += 1;
    console.log('  OK', msg);
  } else {
    failed += 1;
    console.error('  KO', msg);
  }
}

console.log('\n=== A1 — Historique + Équité repliés ===');
assert(html.includes('id="trainHistoryDetails"'), 'details Historique');
assert(html.includes('id="trainEquityDetails"'), 'details Équité');
assert(!/id="trainHistoryDetails"[^>]*\sopen\b/.test(html), 'Historique fermé par défaut');
assert(!/id="trainEquityDetails"[^>]*\sopen\b/.test(html), 'Équité fermée par défaut');
assert(html.includes('class="train-collapsible"'), 'classe collapsible');
assert(css.includes('.train-collapsible'), 'styles collapsible');
assert(css.includes("content: 'Ouvrir'") || css.includes('content: "Ouvrir"'), 'libellé Ouvrir');
assert(css.includes("content: 'Fermer'") || css.includes('content: "Fermer"'), 'libellé Fermer');

console.log('\n=== A2 — Format compteurs uniforme ===');
assert(train.includes('function formatChoiceCounters'), 'formatChoiceCounters');
assert(
  train.includes('Depuis le début : C:') && train.includes('Ce mois : C:'),
  'format Depuis le début / Ce mois'
);
assert(train.includes('formatChoiceCounters(player.id, monthKey)'), 'formatPlayerCounters délégué');
assert(train.includes('return formatChoiceCounters(playerId, monthKey)'), 'formatCountersShort délégué');
assert(train.includes('${escapeHtml(formatChoiceCounters(c.playerId))}'), 'candidats mérite');
assert(train.includes('formatCountersShort(player.id)'), 'tirage VIP');
assert(train.includes('formatPlayerCounters(p)'), 'listes select / remplacement');

console.log('\n=== A3 — Mérite manuel + tri ===');
assert(train.includes('getHistoricalCounts(a.playerId).conductor'), 'tri conducteur historique');
assert(train.includes('Aucune auto-affectation'), 'commentaire pas d’auto-affectation');
assert(train.includes('Mérite — choix manuel'), 'chip mérite manuel');
assert(train.includes('data-train-action="assign-candidate"'), 'affectation manuelle via bouton');
assert(!/autoAssign|auto-assign|presélection|preselectFirst/i.test(train), 'pas d’auto-presélect');

console.log('\n=== A4 — Remplacement visible ===');
assert(train.includes('Remplacer (absence)'), 'libellé Remplacer (absence)');
assert(train.includes('replace-week-role'), 'action replace-week-role');
assert(train.includes('setWeekDayField(dayKey, field, nextId)'), 'maj planning sans retirer');
assert(train.includes('isEligibleForWeekConductor'), 'éligibilité conducteur conservée');
assert(train.includes('isEligibleForWeekVip'), 'éligibilité VIP conservée');
assert(
  !/data-train-action="replace-week-role"[^>]*>Modifier</.test(train),
  'plus de libellé Modifier sur le planning semaine'
);

console.log('\n=== Non-régression règles Train ===');
assert(train.includes('function pickFairByHistorical'), 'tirage équitable inchangé (présent)');
assert(train.includes('function isEligibleForWeekVip'), 'éligibilité VIP');
assert(train.includes('function applyDeltas') || train.includes('applyDeltas('), 'compteurs mois');
assert(train.includes('correctArchivedHistoryRole'), 'correction archive inchangée');

console.log('\n=== Résultat ===');
console.log(`${passed} OK · ${failed} KO`);
process.exit(failed ? 1 : 0);
