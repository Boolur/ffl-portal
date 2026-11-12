import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

// Explicit hosted release step. `npm run build` only compiles; neither local
// verification nor a preview deployment can implicitly migrate the database.
if (process.env.VERCEL === '1' && process.env.VERCEL_ENV === 'production') {
  const result = spawnSync(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy'], { stdio: 'inherit' });
  if (result.error || result.status !== 0) {
    console.error('Schema deployment failed. Application compilation was not started.');
    process.exit(1);
  }
} else {
  console.log('Schema deployment skipped outside a Vercel production release.');
}
