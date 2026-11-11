# VoltaCerta — Fase de transformação em SaaS real

Relatório de entrega (Fases 1 a 12). Complementa o [README](../README.md).

## 1. Diagnóstico inicial (auditoria)

Auditoria feita no código e no banco remoto **antes** de qualquer alteração.

| Item | Resultado |
|---|---|
| Dados mockados no app | **Nenhum.** Todas as telas e formulários já consultavam o Supabase (tabelas, views e RPCs). |
| Dados fictícios existentes | `scripts/demo-server.mjs` + `.env.demo` — servidor de **demonstração local**, separado do app, nunca usado em produção. A prévia ilustrativa da landing é rotulada como "Demonstração ilustrativa". |
| Valores fixos no código | Preços dos planos em `src/domain/labels.ts` (com Premium desatualizado em R$ 99,90). **Removidos** → tabela `plans`. |
| Autenticação | Cadastro, confirmação de e-mail, login, logout, recuperação/redefinição de senha, rotas protegidas, sessão persistente e expiração já funcionavam. |
| RLS | Ativo nas 16 tabelas, conferido no banco remoto. |
| Banco remoto antes da migration | 1 usuário, 1 organização, 0 clientes/compras; migrations 0001–0004 aplicadas. |
| **Problemas de segurança encontrados** | (1) políticas de UPDATE de `profiles` e `organizations` liberavam **qualquer coluna** — com as novas colunas `blocked_at`/`suspended_at`, o próprio usuário poderia desfazer um bloqueio. **Corrigido** com permissão por coluna. (2) Não existia papel de plataforma nem trilha de auditoria administrativa. |
| Faltava | Tabelas `plans` e `payments`, Super Admin, suspensão, bloqueio, papel `employee`, onboarding idempotente, roteamento por subdomínio. |

**Estratégia de preservação:** migration `0005` exclusivamente aditiva (sem `DROP TABLE`, sem recriar tabelas). Renomeação `staff → employee` via `ALTER TYPE … RENAME VALUE` (preserva linhas). Backfill de `trial_started_at`.

## 2. Funcionalidades conectadas ao banco

Todas: dashboard, indicadores e gráficos (`dashboard_metrics`), clientes, pets, produtos, compras (`create_purchase` atômica), previsões (`v_predictions`), recuperação e contatos (`log_contact`), relatórios (`get_report`), atividades recentes, configurações, equipe, planos (`plans`), painel admin (RPCs `admin_*`).

## 3. Dados mockados removidos

- Preços/limites/recursos fixos dos planos no frontend → agora lidos de `public.plans` (landing, página de plano, sidebar, admin).
- Não havia mocks na aplicação para remover. O modo demonstração foi mantido como ferramenta de desenvolvimento, isolado por `--mode demo`.

## 4. Tabelas

Existentes (preservadas): `profiles`, `organizations`, `organization_members`, `organization_invitations`, `subscriptions`, `payment_events`, `customers`, `pets`, `products`, `purchases`, `purchase_items`, `replenishment_predictions`, `message_templates`, `contact_logs`, `audit_logs`, `data_deletion_requests`.

Novas (0005): `plans`, `payments`, `platform_admins`, `admin_audit_logs`.
Colunas novas: `subscriptions.trial_started_at/current_period_start`, `profiles.blocked_at/blocked_reason/blocked_by`, `organizations.suspended_at/suspended_reason/suspended_by`.

## 5. Migrations

| Migration | Status |
|---|---|
| 0001–0004 | aplicadas no projeto remoto |
| `20261111000005_platform_admin_plans.sql` | criada, testada (PGlite/PostgreSQL 18) e aplicada no remoto — ver seção 12 |

## 6. Políticas RLS e autorização

- Todas as tabelas privadas com RLS; vínculo usuário↔organização validado por `is_org_member` / `has_org_role` (que agora também negam usuários bloqueados).
- `plans`: leitura pública (preços), sem escrita para `anon`/`authenticated` (só `admin_update_plan`).
- `payments`: leitura por owner/admin da própria organização; escrita só backend.
- `platform_admins`, `admin_audit_logs`: sem políticas → invisíveis ao cliente; acesso só por RPC de Super Admin.
- UPDATE em `profiles` restrito a `full_name`; em `organizations`, às colunas de configuração (nunca `suspended_*`).
- Estabelecimento suspenso → `org_can_write = false` (somente leitura, aplicado no banco).

Papéis: `owner`, `admin`, `employee` (por organização) e `super_admin` (plataforma, em `platform_admins` + espelhado em `app_metadata.role`). A decisão de autorização no servidor usa a tabela (revogação imediata); `app_metadata` é só indicativo e só o backend o altera.

## 7. Autenticação

- Cadastro → e-mail de confirmação → onboarding.
- `create_organization` agora é **idempotente**: chamadas repetidas ou retomadas após falha devolvem a mesma organização (lock por usuário); segunda organização só com `p_additional` (seletor "Adicionar estabelecimento"). Org + vínculo owner + trial de 14 dias + modelos são criados na **mesma transação**.
- Login com e-mail não confirmado oferece **reenviar confirmação**.
- Conta bloqueada → tela "Acesso bloqueado" (o bloqueio real é no banco).

## 8. Criação do primeiro Super Admin

1. Crie a conta normalmente no app (cadastro + confirmação de e-mail).
2. No terminal, na pasta do projeto, com o Supabase CLI logado e vinculado:
   ```bash
   VOLTA_ADMIN_EMAIL=seu-email@dominio.com npm run admin:promote
   ```
   (alternativa: `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` no terminal ou em `.env.admin`, que é ignorado pelo git).
3. O script valida o e-mail, chama `public.promote_super_admin(email)` (executável só por postgres/service_role), que confirma a existência do usuário, grava `platform_admins` e `app_metadata`, registra em `admin_audit_logs` e devolve o resultado.
4. Revogar: `npm run admin:promote -- --revoke`.

Não há rota pública de promoção; nenhuma credencial administrativa vai para o frontend; `service_role` nunca é usada no navegador.

## 9. Painel administrativo

Entrada própria (`src/admin/AdminRoot.tsx`, bundle separado), roteamento próprio e login próprio. Em produção: `admin.voltacerta.com.br`; em desenvolvimento: `http://localhost:5173/admin`.

- **Visão geral:** estabelecimentos, usuários, assinaturas ativas, trials ativos/encerrados, atrasadas, canceladas, receita **efetivamente recebida** (soma de `payments` pagos nos últimos 30 dias), evolução de cadastros.
- **Estabelecimentos:** lista, busca, filtro por status, detalhe (usuários, contagens, assinatura, pagamentos, histórico), **suspender/reativar com justificativa**.
- **Assinaturas:** plano, status, vencimentos; **conceder trial** (1–90 dias, nunca sobre assinatura paga ativa); **alterar plano** (não altera status nem marca pago); pagamentos.
- **Usuários:** busca, organizações e papéis, último acesso, **bloquear/desbloquear com justificativa** (não permite bloquear a si mesmo nem outro Super Admin). Senhas e segredos nunca são lidos.
- **Planos:** edição de preço e limite (auditada).
- **Auditoria:** responsável, data, operação, alvo, detalhes e justificativa.

Toda operação é uma RPC que valida `is_super_admin()` no banco e grava `admin_audit_logs`.

## 10. Configuração de domínios (pendente — dependências externas)

Um único build publicado nos três domínios; a superfície é escolhida pelo hostname (`src/lib/hosts.ts`).

| Domínio | Conteúdo |
|---|---|
| `voltacerta.com.br` | landing; `/entrar`, `/cadastro` etc. redirecionam para o app |
| `app.voltacerta.com.br` | painel dos estabelecimentos (`/` → `/app`) |
| `admin.voltacerta.com.br` | painel Super Admin |

Passos:
1. **Vercel**: importar o repositório; em *Settings → Domains* adicionar os três domínios (e `www.voltacerta.com.br` redirecionando para o raiz).
2. **DNS** (no registrador do domínio): registros indicados pela Vercel — normalmente `A @ 76.76.21.21` e `CNAME app/admin/www → cname.vercel-dns.com`. HTTPS é emitido automaticamente pela Vercel.
3. **Variáveis na Vercel**: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SITE_URL`, `VITE_APP_URL`, `VITE_ADMIN_URL`, `VITE_APP_ENV=production`.
4. **Supabase → Authentication → URL Configuration**: *Site URL* `https://app.voltacerta.com.br`; *Redirect URLs*: `https://app.voltacerta.com.br/**`, `https://admin.voltacerta.com.br/**` (e `http://localhost:5173/**` para desenvolvimento).
5. **Sessões**: cada subdomínio mantém sua própria sessão (armazenamento por origem). Entrar no app não loga no admin e vice-versa — isolamento intencional.

## 11. Planos e trial

Valores centralizados em `public.plans` (Inicial R$ 39,90 / 100 clientes; Profissional R$ 69,90 / 500; Premium R$ 279,90 / ilimitado). Limite de clientes aplicado por trigger; recursos por `plan_allows()` (lê `plans.features`); escrita bloqueada por `org_can_write()` quando trial vence, assinatura expira/cancela ou o estabelecimento é suspenso. Estados: `trialing`, `active`, `past_due`, `canceled`, `expired` (trial vencido é calculado como `expired`).

## 12. Pagamentos

> **Atualização:** integração com a AbacatePay implementada (migration 0007, Edge Functions e tela de plano). Veja [PAGAMENTOS.md](PAGAMENTOS.md). A tabela abaixo é histórica.

Nenhum checkout real; nenhum pagamento simulado; nenhum plano pago liberado sem confirmação.

| Requisito | Situação |
|---|---|
| Credenciais | `ABACATEPAY_API_KEY` (ou Asaas) como *secret* da Edge Function |
| Checkout | `billing-checkout` valida usuário/owner; falta chamar a API do provedor (documentação oficial) e retornar a URL |
| Webhooks | `billing-webhook` pronto: HMAC-SHA256 + comparação em tempo constante |
| Validação de assinatura | confirmar nome do cabeçalho e formato com o provedor (`BILLING_SIGNATURE_HEADER`, `EVENT_TYPE_MAP`) |
| Idempotência | `payment_events unique(provider, event_id)` + `payments unique(provider, provider_payment_id)` |
| Atualização de assinatura | `subscriptionUpdateFor()` → `subscriptions` |
| Histórico de cobranças | tabela `payments` (inserir no webhook ao confirmar cobrança) |

## 13. Testes executados

`npm test` — 73 testes (4 arquivos), todos passando, rodando as migrations reais em PostgreSQL 18 (PGlite) sob RLS:
- `tests/db/database.test.ts` (32): cadastro/onboarding, isolamento entre organizações, clientes, produtos, compras, cálculo e atualização da recompra, contatos, indicadores, limites do plano, trial expirado, convites, LGPD.
- `tests/db/platform.test.ts` (20): planos centralizados e limites vindos da tabela, onboarding idempotente, colunas privilegiadas protegidas, promoção do Super Admin só pelo backend, FORBIDDEN em todas as RPCs admin para usuário comum, visão geral e MRR só com pagamentos confirmados, suspensão/reativação auditadas, trial e troca de plano sem marcar pago, bloqueio de usuário cortando acesso, revogação de Super Admin, papel `employee`.
- `tests/unit/*` (21): utilitários, validação e webhook.

Verificado no navegador (modo demonstração): painel admin (login, visão geral, estabelecimentos, detalhe, suspensão com justificativa, usuários, planos, auditoria) e preços da landing vindos da tabela.

**Não testado de ponta a ponta:** cadastro/login/recuperação de senha contra o Supabase real pelo navegador (exige e-mail e senha reais do usuário), Edge Functions em runtime Deno, subdomínios reais (DNS ainda não configurado).

## 14. Pendências para produção

1. Configurar domínios, DNS, Vercel e URLs do Supabase Auth (seção 10).
2. Promover a conta do Super Admin (seção 8).
3. SMTP próprio no Supabase Auth (o padrão tem limite baixo de e-mails).
4. Integrar o gateway de pagamento (seção 12) e o job de expiração de `past_due`.
5. Revisão jurídica de Termos e Privacidade.
6. Monitoramento de erros e backups/PITR.
7. Testes E2E (Playwright) em ambiente de staging.

---

# Auditoria Supabase — 10/11/2026 (pós-fase SaaS)

## Estado encontrado

| Pergunta | Resultado verificado |
|---|---|
| Tabelas no Supabase | 20 tabelas em `public`, todas com RLS; 2 views `security_invoker`; migrations 0001–0005 aplicadas. |
| Dados reais × mocks | Dados reais: `profiles`(1), `organizations`(1), `organization_members`(1), `subscriptions`(1), `message_templates`(3), `products`(1), `plans`(3), `platform_admins`(1), `audit_logs`(11), `admin_audit_logs`(2). As demais estão vazias porque ainda não houve uso; nenhuma usa mock. |
| Supabase Auth | E-mail/senha ativo, confirmação obrigatória (`mailer_autoconfirm=false`), cadastro aberto, MFA TOTP disponível. **Problema:** `Site URL = http://localhost:3000` e nenhuma Redirect URL → os links de confirmação e de recuperação de senha não abriam o app. |
| Cadastro → usuário + organização + vínculo | Funciona: o usuário real tem perfil, organização, vínculo `owner`, trial de 14 dias e modelos criados. |
| RLS implementado e testado | Sim: políticas só para `authenticated` (exceto leitura pública de `plans`), validadas por `is_org_member`/`has_org_role` no servidor. |
| Isolamento entre organizações | Sim, comprovado no banco remoto (teste de fumaça abaixo). |
| Frontend conectado | Todas as telas: 14 tabelas/views e 16 RPCs; nenhum dado fixo. |
| Sem persistência real | Nenhuma funcionalidade. Só a prévia da landing é ilustrativa, e está rotulada como tal. |
| **Achado de segurança** | Supabase Advisors (lint 0028): **37 funções SECURITY DEFINER executáveis por `anon`**, por causa do grant implícito a `PUBLIC`. Os corpos exigiam login, então não havia vazamento, mas a superfície pública precisa ser zero. |

## Implementado / corrigido

- `supabase/migrations/20261111000006_harden_function_grants.sql` (aplicada no remoto): revoga `EXECUTE` de `PUBLIC`/`anon` em todas as funções do schema `public`, mantém por grant explícito o que `authenticated`/`service_role` já tinham e muda os privilégios padrão para que novas funções não nasçam públicas.
- `supabase/config.toml`: Redirect URLs (`localhost:5173/**` e os três domínios de produção) e `major_version = 17`, igual ao remoto.
- `scripts/remote-smoke-test.sql`: teste de ponta a ponta no banco real que **se desfaz sozinho** (termina em `RAISE EXCEPTION`, o que reverte tudo).
- 4 testes novos em `tests/db/platform.test.ts`.

## Testes executados

- `npm test`: **77/77** passando (PostgreSQL 18 via PGlite, migrations reais, RLS).
- Teste de fumaça no **banco remoto**: **30/30** verificações. Cobertura: cadastro dispara a criação do perfil; onboarding cria organização, vínculo owner, trial e modelos, e é idempotente; criar e editar cliente; criar, desativar e reativar produto; compra (total 150,00); previsão em D+5; contato; dashboard; exclusão de compra e de cliente. Isolamento: B não lê, não altera e não apaga dados de A (0 linhas); inserir na organização de A é barrado pela RLS; RPCs com o `organization_id` de A retornam FORBIDDEN; RPC admin retorna FORBIDDEN. `anon` recebe *permission denied* em tabelas e RPCs. Depois do teste, as contagens do banco continuaram idênticas.
- API HTTP real, como cliente anônimo: tabelas privadas e RPCs → **401**; `plans` → 200; login com senha errada → 400 `invalid_credentials`.
- Advisors depois da correção: o alerta de `anon` foi zerado. Restam `authenticated_security_definer_function_executable`, que é intencional (são as RPCs do app e validam membro/papel internamente), e `auth_leaked_password_protection`.
- `tsc`, `eslint` e `vite build`: ok.

**Não testado pelo navegador:** criar uma conta nova pelo formulário contra o Supabase real. Isso exige um e-mail e uma senha reais, e o envio de e-mail depende da correção das URLs do Auth. O cadastro real que já existe, o login e o painel admin foram usados com sucesso: há `last_sign_in` registrado e uma ação `change_plan` na auditoria.

## Pendente (exige você no painel do Supabase)

1. ~~URLs do Auth~~ — **aplicado em 10/11/2026** via `supabase config push` (Site URL `http://localhost:5173` + Redirect URLs de `config.toml`). Ao publicar, trocar a Site URL para `https://app.voltacerta.com.br`.
2. **Authentication → Providers → Email → senha**: ativar a "Leaked password protection" (pode exigir o plano Pro).
3. SMTP próprio, deploy, domínios e gateway de pagamento, que continuam na seção 14 acima.
