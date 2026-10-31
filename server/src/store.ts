/**
 * Shared state in Postgres: packing ticks, kept GitHub pictures, view-only links and discussions. Migrations are plain SQL
 * files in `migrations/`, applied in name order on start, each once.
 */

import { readdir, readFile } from 'node:fs/promises'

import pg from 'pg'

import type { Avatar, AvatarStore } from './avatars'
import type { Comment, CommentStore, Thread } from './comments'
import type { LinkStore, ShareLink } from './links'
import { MAX_TICKS, validChanges, type Ticks } from './packing'

export interface Store extends AvatarStore, LinkStore, CommentStore {
  ticks(trip: string): Promise<Ticks>
  /** Stores the valid changes newer than what is there, as set by `by`. */
  apply(trip: string, changes: unknown, now: number, by: string | null): Promise<void>
  close(): Promise<void>
}

const MIGRATIONS = new URL('../migrations/', import.meta.url)

export async function migrate(pool: pg.Pool): Promise<string[]> {
  const client = await pool.connect()
  try {
    // One server migrates at a time; the others wait for it.
    await client.query('select pg_advisory_lock(7317)')
    await client.query(
      'create table if not exists taac_migrations (name text primary key, at timestamptz not null default now())',
    )
    const done = new Set(
      (await client.query<{ name: string }>('select name from taac_migrations')).rows.map((r) => r.name),
    )
    const applied: string[] = []
    for (const name of (await readdir(MIGRATIONS)).filter((f) => f.endsWith('.sql')).sort()) {
      if (done.has(name)) continue
      const sql = await readFile(new URL(name, MIGRATIONS), 'utf8')
      await client.query('begin')
      try {
        await client.query(sql)
        await client.query('insert into taac_migrations (name) values ($1)', [name])
        await client.query('commit')
      } catch (error) {
        await client.query('rollback')
        throw error
      }
      applied.push(name)
    }
    return applied
  } finally {
    await client.query('select pg_advisory_unlock(7317)').catch(() => undefined)
    client.release()
  }
}

export async function openStore(connectionString: string): Promise<Store> {
  const pool = new pg.Pool({ connectionString, max: 5 })
  await migrate(pool)
  return {
    async ticks(trip) {
      const { rows } = await pool.query<{
        item: string
        member: string
        packed: boolean
        at: string
        by_login: string | null
      }>('select item, member, packed, at, by_login from packing_ticks where trip = $1', [trip])
      return Object.fromEntries(
        rows.map((r) => [
          `${r.item}|${r.member}`,
          { packed: r.packed, at: Number(r.at), ...(r.by_login ? { by: r.by_login } : {}) },
        ]),
      )
    },
    async apply(trip, changes, now, by) {
      const valid = validChanges(changes, now)
      if (!valid.length) return
      const client = await pool.connect()
      try {
        await client.query('begin')
        const { rows } = await client.query<{ n: string }>('select count(*) as n from packing_ticks where trip = $1', [
          trip,
        ])
        let count = Number(rows[0]?.n ?? 0)
        for (const c of valid) {
          // A new row only while there is room; an existing one only for a newer stamp.
          const result = await client.query<{ inserted: boolean }>(
            `insert into packing_ticks (trip, item, member, packed, at, by_login)
             select $1, $2, $3, $4, $5, $7 where $6 or exists (
               select 1 from packing_ticks where trip = $1 and item = $2 and member = $3)
             on conflict (trip, item, member) do update
               set packed = excluded.packed, at = excluded.at, by_login = excluded.by_login
               where packing_ticks.at < excluded.at
             returning (xmax = 0) as inserted`,
            [trip, c.item, c.member, c.packed, c.at, count < MAX_TICKS, by],
          )
          if (result.rows[0]?.inserted) count++
        }
        await client.query('commit')
      } catch (error) {
        await client.query('rollback')
        throw error
      } finally {
        client.release()
      }
    },
    async avatar(login) {
      const { rows } = await pool.query<{ type: string | null; image: Buffer | null; fetched_at: string }>(
        'select type, image, fetched_at from avatars where login = $1',
        [login],
      )
      const row = rows[0]
      return row ? { type: row.type, image: row.image, fetchedAt: Number(row.fetched_at) } : null
    },
    async putAvatar(login, avatar: Avatar) {
      await pool.query(
        `insert into avatars (login, type, image, fetched_at) values ($1, $2, $3, $4)
         on conflict (login) do update set type = excluded.type, image = excluded.image, fetched_at = excluded.fetched_at`,
        [login, avatar.type, avatar.image ? Buffer.from(avatar.image) : null, avatar.fetchedAt],
      )
    },
    async createLink(link) {
      await pool.query(
        `insert into share_links (id, trip, token, label, created_by, created_at, expires_at)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [link.id, link.trip, link.token, link.label, link.createdBy, link.createdAt, link.expiresAt],
      )
    },
    async links(trip, now) {
      const { rows } = await pool.query<LinkRow>(
        `select * from share_links where trip = $1 and revoked_at is null and (expires_at is null or expires_at > $2)
         order by created_at desc`,
        [trip, now],
      )
      return rows.map(fromRow)
    },
    async linkByToken(token) {
      const { rows } = await pool.query<LinkRow>('select * from share_links where token = $1', [token])
      return rows[0] ? fromRow(rows[0]) : null
    },
    async linkById(id) {
      const { rows } = await pool.query<LinkRow>('select * from share_links where id = $1', [id])
      return rows[0] ? fromRow(rows[0]) : null
    },
    async revokeLink(trip, id, by, now) {
      const { rowCount } = await pool.query(
        'update share_links set revoked_at = $4, revoked_by = $3 where trip = $1 and id = $2 and revoked_at is null',
        [trip, id, by, now],
      )
      return (rowCount ?? 0) > 0
    },
    async touchLink(id, now) {
      await pool.query('update share_links set last_used_at = $2 where id = $1', [id, now])
    },
    async threads(trip) {
      const { rows: threads } = await pool.query<ThreadRow>(
        'select * from threads where trip = $1 order by created_at',
        [trip],
      )
      const { rows: comments } = await pool.query<CommentRow>(
        `select c.* from comments c join threads t on t.id = c.thread_id where t.trip = $1 order by c.created_at`,
        [trip],
      )
      return withComments(threads, comments)
    },
    async thread(id) {
      const { rows: threads } = await pool.query<ThreadRow>('select * from threads where id = $1', [id])
      if (!threads.length) return null
      const { rows: comments } = await pool.query<CommentRow>(
        'select * from comments where thread_id = $1 order by created_at',
        [id],
      )
      return withComments(threads, comments)[0] ?? null
    },
    async createThread(thread) {
      const client = await pool.connect()
      try {
        await client.query('begin')
        await client.query(
          'insert into threads (id, trip, anchor, created_by, created_at) values ($1, $2, $3, $4, $5)',
          [thread.id, thread.trip, thread.anchor, thread.createdBy, thread.createdAt],
        )
        for (const c of thread.comments) await insertComment(client, thread.id, c)
        await client.query('commit')
      } catch (error) {
        await client.query('rollback')
        throw error
      } finally {
        client.release()
      }
    },
    async addComment(threadId, comment) {
      await insertComment(pool, threadId, comment)
    },
    async resolveThread(id, by, now) {
      await pool.query('update threads set resolved_at = $2, resolved_by = $3 where id = $1', [
        id,
        by === null ? null : now,
        by,
      ])
    },
    async editComment(id, body, now) {
      await pool.query('update comments set body = $2, edited_at = $3 where id = $1 and deleted_at is null', [
        id,
        body,
        now,
      ])
    },
    async deleteComment(id, now) {
      await pool.query("update comments set body = '', deleted_at = $2 where id = $1", [id, now])
    },
    async comment(id) {
      const { rows } = await pool.query<CommentRow & { trip: string }>(
        'select c.*, t.trip from comments c join threads t on t.id = c.thread_id where c.id = $1',
        [id],
      )
      return rows[0] ? { ...fromComment(rows[0]), trip: rows[0].trip } : null
    },
    close: () => pool.end(),
  }
}

interface LinkRow {
  id: string
  trip: string
  token: string
  label: string
  created_by: string
  created_at: string
  expires_at: string | null
  revoked_at: string | null
  revoked_by: string | null
  last_used_at: string | null
}

const num = (v: string | null) => (v === null ? null : Number(v))

function fromRow(r: LinkRow): ShareLink {
  return {
    id: r.id,
    trip: r.trip,
    token: r.token,
    label: r.label,
    createdBy: r.created_by,
    createdAt: Number(r.created_at),
    expiresAt: num(r.expires_at),
    revokedAt: num(r.revoked_at),
    revokedBy: r.revoked_by,
    lastUsedAt: num(r.last_used_at),
  }
}

interface ThreadRow {
  id: string
  trip: string
  anchor: string
  created_by: string
  created_at: string
  resolved_at: string | null
  resolved_by: string | null
}

interface CommentRow {
  id: string
  thread_id: string
  author: string
  body: string
  created_at: string
  edited_at: string | null
  deleted_at: string | null
}

function fromComment(r: CommentRow): Comment {
  return {
    id: r.id,
    author: r.author,
    body: r.body,
    createdAt: Number(r.created_at),
    editedAt: num(r.edited_at),
    deletedAt: num(r.deleted_at),
  }
}

function withComments(threads: ThreadRow[], comments: CommentRow[]): Thread[] {
  const byThread = new Map<string, CommentRow[]>()
  for (const c of comments) byThread.set(c.thread_id, [...(byThread.get(c.thread_id) ?? []), c])
  return threads.map((t) => ({
    id: t.id,
    trip: t.trip,
    anchor: t.anchor,
    createdBy: t.created_by,
    createdAt: Number(t.created_at),
    resolvedAt: num(t.resolved_at),
    resolvedBy: t.resolved_by,
    comments: (byThread.get(t.id) ?? []).map(fromComment),
  }))
}

function insertComment(db: pg.Pool | pg.PoolClient, threadId: string, c: Comment) {
  return db.query('insert into comments (id, thread_id, author, body, created_at) values ($1, $2, $3, $4, $5)', [
    c.id,
    threadId,
    c.author,
    c.body,
    c.createdAt,
  ])
}
