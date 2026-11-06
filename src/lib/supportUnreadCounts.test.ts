import { createRequire } from 'node:module';
import type { Prisma } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { queryRaw } = vi.hoisted(() => ({ queryRaw: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: { $queryRaw: queryRaw } }));
import { getSupportUnreadCounts } from './supportUnreadCounts';

type TestDatabase = {
  exec(sql: string): void;
  prepare(sql: string): { all(...values: unknown[]): unknown[]; run(...values: unknown[]): void };
  close(): void;
};
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (filename: string) => TestDatabase;
};

describe('batched support unread counts', () => {
  let db: TestDatabase;
  beforeEach(() => {
    queryRaw.mockReset();
    db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE SupportMessage (conversationId TEXT, authorId TEXT, createdAt TEXT);
      CREATE TABLE SupportConversationReadState (conversationId TEXT, userId TEXT, lastReadAt TEXT);
      INSERT INTO SupportConversationReadState VALUES ('read', 'viewer', '2026-11-01T10:00:00Z');
      INSERT INTO SupportConversationReadState VALUES ('new', 'someone-else', '2026-12-01T00:00:00Z');
      INSERT INTO SupportMessage VALUES
        ('read', 'staff', '2026-11-01T09:59:59Z'),
        ('read', 'staff', '2026-11-01T10:00:00Z'),
        ('read', 'staff', '2026-11-01T10:00:01Z'),
        ('read', 'viewer', '2026-11-01T10:00:02Z'),
        ('new', 'staff', '2026-11-01T09:00:00Z'),
        ('new', 'staff', '2026-11-01T10:00:00Z'),
        ('not-authorized', 'staff', '2026-11-01T10:00:00Z');
    `);
    // Execute the actual join/filter query against relational fixtures. SQLite
    // uses the same SQL here except the PostgreSQL integer-cast spelling.
    queryRaw.mockImplementation(async (query: Prisma.Sql) =>
      db.prepare(query.sql.replace('COUNT(*)::int', 'COUNT(*)')).all(...query.values),
    );
  });
  afterEach(() => db.close());

  it('preserves per-user cursors, strict after-read comparison, own-message exclusion and authorized IDs', async () => {
    const counts = await getSupportUnreadCounts(['read', 'new', 'empty', 'read'], 'viewer');
    expect(Object.fromEntries(counts)).toEqual({ read: 1, new: 2 });
    expect(queryRaw).toHaveBeenCalledOnce();
  });

  it('does no database work for an empty authorized conversation set', async () => {
    expect((await getSupportUnreadCounts([], 'viewer')).size).toBe(0);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('binds identity strings as parameters, including punctuation that resembles SQL', async () => {
    const id = "conversation') OR 1=1 --";
    db.prepare('INSERT INTO SupportMessage VALUES (?, ?, ?)').run(id, 'staff', '2026-11-01T10:00:00Z');
    expect(Object.fromEntries(await getSupportUnreadCounts([id], 'viewer'))).toEqual({ [id]: 1 });
  });
});
