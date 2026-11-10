import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(here, '..', '..', 'supabase', 'migrations')

export type Db = Awaited<ReturnType<typeof createDb>>

/** Cria um Postgres embutido com o stub do Supabase + todas as migrations. */
export async function createDb() {
  const pg = new PGlite()
  await pg.exec(readFileSync(join(here, 'supabase-stub.sql'), 'utf8'))
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    try {
      await pg.exec(readFileSync(join(migrationsDir, file), 'utf8'))
    } catch (e) {
      throw new Error(`Migration ${file} falhou: ${(e as Error).message}`, { cause: e })
    }
  }

  async function createUser(email: string): Promise<string> {
    const r = await pg.query<{ id: string }>('insert into auth.users (email) values ($1) returning id', [email])
    return r.rows[0].id
  }

  /** Executa SQL como usuário autenticado (role authenticated + JWT sub), sujeito a RLS. */
  function as(userId: string | null) {
    async function run<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      const claims = userId ? JSON.stringify({ sub: userId, role: 'authenticated' }) : ''
      await pg.query(`select set_config('request.jwt.claims', $1, false)`, [claims])
      await pg.exec(userId ? 'set role authenticated' : 'set role anon')
      try {
        const r = await pg.query<T>(sql, params)
        return r.rows
      } finally {
        await pg.exec('reset role')
        await pg.query(`select set_config('request.jwt.claims', '', false)`)
      }
    }
    return {
      query: run,
      one: async <T>(sql: string, params: unknown[] = []) => (await run<T>(sql, params))[0],
    }
  }

  /** Acesso como superusuário (equivalente ao service role) para preparar cenários. */
  const admin = {
    query: async <T>(sql: string, params: unknown[] = []) => (await pg.query<T>(sql, params)).rows,
  }

  return { pg, createUser, as, admin }
}

/** Cria usuário + organização via RPC real e retorna ids. */
export async function setupOrg(db: Db, email: string, name = 'Pet Shop Teste') {
  const userId = await db.createUser(email)
  const { create_organization: orgId } = await db.as(userId).one<{ create_organization: string }>(
    'select public.create_organization($1, $2, $3, $4, $5, $6)',
    [name, 'Responsável', '(11) 3333-4444', 'São Paulo', 'SP', 'pet_shop'],
  )
  return { userId, orgId, user: db.as(userId) }
}
