// Runs the full test suite but refuses to pass unless the server is genuine MongoDB (not FerretDB).
// A Node script instead of `REQUIRE_GENUINE_MONGODB=1 vitest run`, because that syntax only works in
// macOS/Linux shells, not in Windows PowerShell or Command Prompt.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const vitestCli = path.join(path.dirname(require.resolve('vitest/package.json')), 'vitest.mjs');
const result = spawnSync(process.execPath, [vitestCli, 'run', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, REQUIRE_GENUINE_MONGODB: '1' },
});
process.exit(result.status ?? 1);
