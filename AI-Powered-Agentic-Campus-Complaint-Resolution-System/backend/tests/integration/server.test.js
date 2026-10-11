import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupDb, teardownDb, serverIdentity } from '../helpers.js';

// Records which database server the suite actually ran against, so results are never mistaken for
// genuine-MongoDB results when another compatible server was used.
describe('database server identity', () => {
  let id;
  beforeAll(async () => { await setupDb('identity'); id = await serverIdentity(); });
  afterAll(teardownDb);
  it('reports the server product and version', () => {
    console.log(`[server-identity] product=${id.product} reportedVersion=${id.reportedVersion} genuineMongoDB=${id.genuineMongoDB}`);
    expect(id.reportedVersion).toMatch(/^\d+\.\d+/);
    if (process.env.REQUIRE_GENUINE_MONGODB === '1') expect(id.genuineMongoDB).toBe(true);
  });
});
