#!/bin/sh
# Runs unit tests under several time zones (DST edge cases) plus the catalog validator.
set -e
cd "$(dirname "$0")/.."
T=$(mktemp -d); cp *.js "$T"; echo '{"type":"module"}' > "$T/package.json"
for tz in America/Chicago UTC Asia/Tokyo America/Santiago America/Sao_Paulo Australia/Lord_Howe Pacific/Kiritimati; do
  printf "%s: " "$tz"; TZ=$tz node "$T/tests.js" >/dev/null && echo pass
done
node scripts/validate-data.mjs
# corrupt-storage startup
cat > "$T/corrupt.mjs" <<'JS'
const mem = { 'larder-improved-v4': '{not json' };
globalThis.localStorage = { getItem: k => mem[k] ?? null, setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } };
const app = await import('./app.js');
if (app.loadProblem !== 'corrupt' || !Object.keys(mem).some(k => k.includes('corrupt'))) { console.error('corrupt handling failed'); process.exit(1); }
globalThis.localStorage.setItem = () => { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; };
let called = false; app.onSaveError(() => { called = true; });
if (app.saveState() !== false || !called) { console.error('quota handling failed'); process.exit(1); }
console.log('corrupt/quota storage: pass');
JS
node "$T/corrupt.mjs"
