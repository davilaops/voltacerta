/**
 * Promove (ou revoga) o Super Admin do VoltaCerta — procedimento de BACKEND.
 *
 * Nunca roda no navegador e não existe rota pública para isso. Executa a
 * função public.promote_super_admin(email), que só pode ser chamada por
 * postgres/service_role. A função:
 *   1. localiza o usuário em auth.users pelo e-mail;
 *   2. falha se ele não existir (a conta precisa ter sido criada antes);
 *   3. registra em public.platform_admins e grava app_metadata.role = "super_admin";
 *   4. registra a operação em public.admin_audit_logs;
 *   5. retorna o resultado, exibido abaixo.
 *
 * Uso:
 *   VOLTA_ADMIN_EMAIL=voce@empresa.com npm run admin:promote
 *   npm run admin:promote -- --revoke      (remove o acesso)
 *
 * Credenciais (uma das opções, nunca commitadas):
 *   A) Supabase CLI logado e projeto vinculado (npx supabase login / link)  -> padrão
 *   B) SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY no ambiente do terminal
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function loadEnvFile(path) {
  if (!existsSync(path)) return {}
  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split(/\r?\n/)
      .filter((l) => /^\s*[A-Z0-9_]+\s*=/.test(l))
      .map((l) => {
        const i = l.indexOf('=')
        return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]
      }),
  )
}

const fileEnv = { ...loadEnvFile('.env.local'), ...loadEnvFile('.env.admin') }
const env = (k) => process.env[k] ?? fileEnv[k]
const revoke = process.argv.includes('--revoke')
const email = (env('VOLTA_ADMIN_EMAIL') ?? '').trim().toLowerCase()

// Validação estrita: impede qualquer injeção de SQL pelo e-mail
if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)) {
  console.error('✖ Defina VOLTA_ADMIN_EMAIL com um e-mail válido (variável de ambiente ou .env.admin).')
  process.exit(1)
}
const fn = revoke ? 'revoke_super_admin' : 'promote_super_admin'
console.log(`→ ${revoke ? 'Revogando' : 'Promovendo'} Super Admin: ${email}`)

async function viaServiceRole(url, key) {
  const res = await fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_email: email }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.message ?? `HTTP ${res.status}`)
  return body
}

function viaCli() {
  let ref = env('SUPABASE_PROJECT_REF')
  if (!ref && existsSync('supabase/.temp/linked-project.json')) ref = JSON.parse(readFileSync('supabase/.temp/linked-project.json', 'utf8')).ref
  if (!ref) throw new Error('Projeto não vinculado. Rode: npx supabase link --project-ref <ref>')
  if (!/^[a-z0-9]{20}$/.test(ref)) throw new Error(`Project ref inválido: ${ref}`)
  // SQL vai em arquivo temporário: evita problemas de aspas/espaços no shell (Windows)
  const dir = mkdtempSync(join(tmpdir(), 'volta-admin-'))
  const file = join(dir, 'promote.sql')
  writeFileSync(file, `select public.${fn}('${email}') as result;\n`)
  let out
  try {
    out = execFileSync('npx', ['supabase', 'db', 'query', `--remote=${ref}`, '--yes', '--file', file], {
      encoding: 'utf8',
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  const json = JSON.parse(out.slice(out.indexOf('{')))
  if (json.error) throw new Error(json.error.message)
  return json.rows?.[0]?.result
}

try {
  const url = env('SUPABASE_URL')
  const key = env('SUPABASE_SERVICE_ROLE_KEY')
  const result = url && key ? await viaServiceRole(url, key) : viaCli()
  console.log('✔ Concluído:', JSON.stringify(result))
  if (!revoke) console.log('  O acesso vale imediatamente. Entre no painel admin com esta conta (saia e entre de novo se já estiver logado).')
} catch (e) {
  const msg = String(e.stderr ?? e.message ?? e)
  console.error('✖ Falhou:', /USER_NOT_FOUND/.test(msg) ? `nenhuma conta com o e-mail ${email}. Crie a conta no app primeiro.` : msg.slice(0, 500))
  process.exit(1)
}
