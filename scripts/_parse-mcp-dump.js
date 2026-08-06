/**
 * Parse un dump MCP (fichier texte) vers un JSON state utilisable.
 * Usage: node scripts/_parse-mcp-dump.js <mcp.txt> [out.json]
 */
const fs = require('fs');
const path = require('path');

const inPath = process.argv[2];
const outPath = process.argv[3] || path.join(__dirname, '_live-state-dump.json');
if (!inPath || !fs.existsSync(inPath)) {
  console.error('Usage: node scripts/_parse-mcp-dump.js <mcp.txt> [out.json]');
  process.exit(1);
}

let raw = fs.readFileSync(inPath, 'utf8').trim();

// Fichier parfois = JSON.stringify({ result: "…<untrusted>…" })
try {
  const wrapped = JSON.parse(raw);
  if (wrapped && typeof wrapped.result === 'string') raw = wrapped.result;
  else if (Array.isArray(wrapped) || wrapped.state || wrapped.data) {
    raw = JSON.stringify(wrapped);
  }
} catch (_) {
  // texte brut
}

function extractJson(text) {
  // Le prose MCP cite le tag avant le vrai bloc : prendre le dernier ouverture.
  const openRe = /<untrusted-data-[^>]+>/g;
  let openMatch;
  let lastOpen = null;
  while ((openMatch = openRe.exec(text)) !== null) lastOpen = openMatch;
  if (lastOpen) {
    const after = text.slice(lastOpen.index + lastOpen[0].length);
    const closeIdx = after.search(/<\/untrusted-data/);
    if (closeIdx >= 0) {
      const body = after.slice(0, closeIdx).trim();
      if (body.startsWith('[') || body.startsWith('{')) return body;
    }
  }

  const startArr = text.indexOf('[{"state"');
  if (startArr >= 0) {
    const end = text.lastIndexOf(']');
    if (end > startArr) return text.slice(startArr, end + 1);
  }

  const bracket = text.indexOf('[');
  const endBracket = text.lastIndexOf(']');
  if (bracket >= 0 && endBracket > bracket) {
    return text.slice(bracket, endBracket + 1);
  }

  return text.trim();
}

const jsonText = extractJson(raw);
let parsed;
try {
  parsed = JSON.parse(jsonText);
} catch (error) {
  console.error('JSON.parse failed:', error.message);
  console.error('head:', jsonText.slice(0, 120));
  process.exit(1);
}

const row = Array.isArray(parsed) ? parsed[0] : parsed;
const state =
  row?.state ||
  row?.data?.stores?.ros6_command_center_v1 ||
  row?.stores?.ros6_command_center_v1 ||
  row;

if (!state || !state.players || !state.weeks) {
  console.error('État introuvable dans le dump. Clés:', Object.keys(row || {}));
  process.exit(1);
}

fs.writeFileSync(outPath, JSON.stringify(state));
console.log(`wrote ${outPath} (${fs.statSync(outPath).size} bytes)`);
console.log(`players=${state.players.length} weeks=${state.weeks.length} current=${state.currentWeekId}`);
