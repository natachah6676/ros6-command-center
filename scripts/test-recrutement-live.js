/**
 * Test Recrutement sur l’état live Supabase (historique archivé réel).
 * node scripts/test-recrutement-live.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const https = require('https');

const root = path.join(__dirname, '..');
const clientSrc = fs.readFileSync(path.join(root, 'js/supabase-client.js'), 'utf8');
const urlMatch = clientSrc.match(/SUPABASE_URL = '([^']+)'/);
const keyMatch = clientSrc.match(/SUPABASE_PUBLISHABLE_KEY = '([^']+)'/);
if (!urlMatch || !keyMatch) {
  console.error('Clés Supabase introuvables dans supabase-client.js');
  process.exit(1);
}

const SUPABASE_URL = urlMatch[1];
const SUPABASE_KEY = keyMatch[1];

function fetchState() {
  const url = new URL('/rest/v1/ros6_state?id=eq.main&select=data', SUPABASE_URL);
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: 'GET',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          Accept: 'application/json',
        },
      },
      (res) => {
        let body = '';
        res.on('data', (c) => {
          body += c;
        });
        res.on('end', () => {
          if (res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(error);
          }
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  const rows = await fetchState();
  if (!Array.isArray(rows) || !rows[0]?.data) {
    // RLS peut bloquer l’anon : bascule sur dump MCP si fourni
    const dumpPath = process.argv[2];
    if (!dumpPath || !fs.existsSync(dumpPath)) {
      console.error('Impossible de lire ros6_state (RLS ?) et aucun dump fourni.');
      console.error('Usage: node scripts/test-recrutement-live.js [dump.json]');
      process.exit(1);
    }
    const dump = JSON.parse(fs.readFileSync(dumpPath, 'utf8'));
    runOnState(dump.state || dump);
    return;
  }
  const store = rows[0].data?.stores?.ros6_command_center_v1;
  if (!store) {
    console.error('Store ros6_command_center_v1 absent');
    process.exit(1);
  }
  runOnState(store);
}

function runOnState(rawState) {
  const modelsCode = fs.readFileSync(path.join(root, 'js/models.js'), 'utf8');
  const recrutementCode = fs.readFileSync(path.join(root, 'js/recrutement.js'), 'utf8');
  const sandbox = {
    window: {},
    console,
    ROSStorage: {
      getState() {
        return sandbox.__state;
      },
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(modelsCode, sandbox);
  sandbox.ROSModels = sandbox.window.ROSModels;
  vm.runInContext(recrutementCode, sandbox);
  const Recrutement = sandbox.window.RecrutementModule;
  const ROSModels = sandbox.window.ROSModels;

  sandbox.__state = ROSModels.normalizeState(rawState);
  const archived = Recrutement.getArchivedWeeks(sandbox.__state);
  const candidates = Recrutement.getReplacementCandidates(sandbox.__state);
  const allScored = (sandbox.__state.players || [])
    .filter((p) => !Recrutement.isExcludedFromRecruitment(p))
    .map((p) => Recrutement.scorePlayer(p, sandbox.__state))
    .sort((a, b) => b.score - a.score || a.player.pseudo.localeCompare(b.player.pseudo, 'fr'));

  console.log('=== Recrutement live ===');
  console.log(`archived_weeks=${archived.length} ids=${archived.map((w) => w.id).join(',')}`);
  console.log(`current_week=${sandbox.__state.currentWeekId}`);
  console.log(`candidates_ge_15=${candidates.length}`);
  console.log('--- Top scores (y compris < 15) ---');
  allScored.slice(0, 12).forEach((r, i) => {
    console.log(
      `${i + 1}. ${r.player.pseudo} total=${r.score} VS=${r.vsPoints}(${r.vsRedWeeks}R/${r.vsOrangeWeeks}O) Dons=${r.donationPoints}(${r.donationRedWeeks}R/${r.donationOrangeWeeks}O) inactif=${r.inactivePoints} coaching=${r.coachingPoints} weeks=${r.weeksCounted}`
    );
  });
  console.log('--- Liste affichée (≥ 15) ---');
  candidates.slice(0, 15).forEach((r, i) => {
    console.log(
      `${i + 1}. ${r.player.pseudo} total=${r.score} VS=${r.vsPoints}(${r.vsRedWeeks}R/${r.vsOrangeWeeks}O) Dons=${r.donationPoints}(${r.donationRedWeeks}R/${r.donationOrangeWeeks}O) inactif=${r.inactivePoints} coaching=${r.coachingPoints}`
    );
  });

  if (!archived.every((w) => w.archived && w.id !== sandbox.__state.currentWeekId)) {
    throw new Error('Semaines non archivées incluses');
  }
  if (!candidates.every((r) => r.score >= 15)) throw new Error('Seuil 15 non respecté');
  if (!candidates.every((r) => !Recrutement.isExcludedFromRecruitment(r.player))) {
    throw new Error('Exclus présents dans la liste');
  }
  for (let i = 1; i < candidates.length; i += 1) {
    if (candidates[i - 1].score < candidates[i].score) throw new Error('Tri décroissant KO');
  }
  console.log('LIVE_OK');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
