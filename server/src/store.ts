/**
 * Shared state in Postgres: packing ticks for now. Migrations are plain SQL
 * files in `migrations/`, applied in name order on start, each once.
 */

import { readdir, readFile } from 'node:fs/promises'

import pg from 'pg'

import { MAX_TICKS, validChanges, type Ticks } from './packing'

export interface Store {
  ticks(trip: string): Promise<Ticks>
  /** Stores the valid changes newer than what is there. */
  apply(trip: string, changes: unknown, now: number): Promise<void>
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
      const { rows } = await pool.query<{ item: string; member: string; packed: boolean; at: string }>(
        'select item, member, packed, at from packing_ticks where trip = $1',
        [trip],
      )
      return Object.fromEntries(rows.map((r) => [`${r.item}|${r.member}`, { packed: r.packed, at: Number(r.at) }]))
    },
    async apply(trip, changes, now) {
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
            `insert into packing_ticks (trip, item, member, packed, at)
             select $1, $2, $3, $4, $5 where $6 or exists (
               select 1 from packing_ticks where trip = $1 and item = $2 and member = $3)
             on conflict (trip, item, member) do update set packed = excluded.packed, at = excluded.at
               where packing_ticks.at < excluded.at
             returning (xmax = 0) as inserted`,
            [trip, c.item, c.member, c.packed, c.at, count < MAX_TICKS],
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
    close: () => pool.end(),
  }
}
