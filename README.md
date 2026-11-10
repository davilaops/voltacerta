# VoltaCerta

Plataforma SaaS de **recompra inteligente para pet shops**. Identifica quando cada cliente vai precisar repor ração, areia, medicamentos e outros produtos, organiza o contato pelo WhatsApp e mede a receita efetivamente recuperada.

> Stack: React 19 + TypeScript + Vite + Tailwind CSS v4 + componentes no padrão shadcn/ui (Radix) + TanStack Query + React Hook Form + Zod + Recharts · Supabase (PostgreSQL, Auth, Storage, Edge Functions, RLS).

---

## 1. Arquitetura implementada

```
Navegador (SPA React)
   │  chave pública (anon) + JWT do usuário
   ▼
Supabase
   ├─ Auth ............ cadastro, login, recuperação de senha, sessão
   ├─ PostgREST ....... tabelas/views protegidas por RLS
   ├─ RPCs (plpgsql) .. regras de negócio atômicas (SECURITY DEFINER + validação de membro)
   ├─ Storage ......... logos (bucket org-logos, escrita só owner/admin)
   └─ Edge Functions .. billing-checkout, billing-webhook (service role só no servidor)
```

**Decisões principais**

| Decisão | Motivo |
|---|---|
| Regras de negócio no PostgreSQL (RPCs) | Registro de compra, motor de previsão, contatos, indicadores e relatórios rodam no servidor, em transação. O frontend não consegue forjar previsões, vendas recuperadas ou assinaturas. |
| `purchases`, `purchase_items`, `replenishment_predictions`, `contact_logs` sem política de escrita | Só podem ser alteradas pelas RPCs validadas (`create_purchase`, `delete_purchase`, `log_contact`, `set_prediction_status`). |
| Chaves estrangeiras compostas `(id, organization_id)` | Impossível vincular pet/compra/previsão a um registro de outra organização, mesmo com IDs válidos. |
| `organization_id` validado no banco | Políticas RLS (`is_org_member`) e RPCs (`_assert_member`) conferem o vínculo do `auth.uid()`; o valor enviado pelo cliente nunca é confiado. |
| Status temporal derivado em view | `prevista / próxima / hoje / atrasada` são calculados na view `v_predictions` com a data local do estabelecimento (`America/Sao_Paulo` por padrão) — sem jobs agendados e sem defasagem. |
| Limite e recursos de plano no banco | Trigger `enforce_customer_limit` e função `plan_allows()` aplicadas nas RPCs; o frontend apenas reflete. |
| Assinatura expirada = somente leitura | `org_can_write()` nas políticas de inserção/atualização e nas RPCs. |

### Motor de previsão (`compute_expected_days`)

1. `base` = duração média do produto (ou padrão do estabelecimento).
2. Histórico do mesmo cliente + produto: intervalos entre compras consecutivas, **normalizados pela quantidade** da compra anterior (dias por unidade). Cada intervalo é limitado a `[0,4 × base ; 2,5 × base]` para neutralizar outliers.
3. Com pelo menos `history_min_intervals` intervalos (padrão 2), usa a **mediana** dos últimos 6 com peso `w = min(max_weight, n / (n + 3))` (máx. padrão 70%). Poucos registros → peso pequeno → previsão estável.
4. `dias = round(((1 − w) · base + w · histórico) · quantidade)`, entre 1 e 730.

Regras ao registrar compra: a previsão ativa do mesmo produto é encerrada como **recompra concluída** (mesmo se antecipada), uma nova previsão é criada, o histórico é preservado e um índice único parcial impede duas previsões ativas por cliente+produto. Compras retroativas entram no histórico sem substituir a previsão vigente. Excluir uma compra remove as previsões geradas por ela e reabre as que ela encerrou.

**Venda recuperada** = recompra concluída até `attribution_days` (padrão 30) após um contato registrado com o cliente. Recompras sem contato são "espontâneas" e **não** entram na receita recuperada. Valor potencial é sempre exibido separado e rotulado como estimativa.

---

## 2. Estrutura de pastas

```
├─ src/
│  ├─ components/
│  │  ├─ ui/          # design system: button, input, card/badge/skeleton, dialog/sheet/confirm, menu/tabs, states
│  │  ├─ layout/      # AppShell (sidebar fixa, menu móvel, barra inferior, banners)
│  │  ├─ shared/      # ContactDialog (WhatsApp), PurchaseDialog, CustomerDialog, ProductDialog, PeriodFilter…
│  │  └─ brand/       # Logo
│  ├─ features/       # organização por domínio (api.ts = hooks TanStack Query + páginas)
│  │  ├─ auth/ onboarding/ org/ dashboard/ customers/ products/ purchases/
│  │  ├─ replenishment/ recovery/ reports/ settings/ billing/
│  ├─ lib/            # supabase, erros, datas (fuso BR), whatsapp, csv, formatação, telefone
│  ├─ domain/         # rótulos, planos, estados
│  ├─ types/          # tipos de domínio
│  └─ pages/          # landing, ajuda, páginas legais, 404
├─ supabase/
│  ├─ migrations/     # 4 migrations versionadas (schema, RLS, regras, storage)
│  ├─ functions/      # billing-checkout, billing-webhook, _shared/billing.ts
│  └─ config.toml
├─ tests/
│  ├─ db/             # integração: migrations reais em PGlite + stub do Supabase
│  └─ unit/           # utilitários, validação, webhook
└─ public/            # favicon, og-image, robots.txt, sitemap.xml, _redirects
```

---

## 3. Funcionalidades concluídas

- **Autenticação**: cadastro (com aceite de termos), login, recuperação e redefinição de senha, logout, rotas protegidas, sessão persistente, encerramento automático quando o token expira.
- **Onboarding em 7 etapas** (estabelecimento, responsável, telefone, cidade/UF, tipo, primeiro produto, primeiro cliente), com etapas opcionais puláveis e retomada se interrompido.
- **Multi-tenant**: múltiplos estabelecimentos por usuário, seletor de estabelecimento, isolamento total por RLS.
- **Dashboard**: 6 indicadores reais, 4 gráficos (receita recuperada, pipeline de recompra, evolução de clientes, distribuição por situação), filtros 7/30/90 dias e personalizado, "Clientes que precisam de atenção" com WhatsApp e cadastro, atividades recentes.
- **Clientes (CRM)**: CRUD, vários pets por cliente, busca por nome/telefone, filtro por situação, paginação, deduplicação por telefone normalizado, página individual com dados, pets, compras, produtos habituais, próximas recompras, contatos e vendas recuperadas.
- **Produtos**: catálogo com categorias, marca, SKU único, preço, custo, tamanho/unidade, duração média configurável, ativo/inativo; exclusão bloqueada se houver compras (sugere desativar).
- **Compras**: múltiplos itens, preço histórico, desconto por item e geral, data local, idempotência (`client_request_id`) contra duplo clique, registro pelo cadastro do cliente, exclusão com reabertura de previsões.
- **Motor de previsão** com histórico, estados configuráveis e regras de recompra (seção 1).
- **Central de recompras**: abas Todas/Próximas/Para hoje/Atrasadas/Contatadas/Concluídas, filtros por período, produto, categoria e cliente, ordenação por data e valor potencial, ignorar oportunidade.
- **Recuperação de clientes**: fila por urgência, modelos de mensagem com variáveis, link `wa.me` codificado, registro **somente após confirmação** com resultado (respondeu, não respondeu, comprou, sem interesse, retornar depois + data), usuário responsável, histórico da equipe, rate limit.
- **Relatórios** (8): vendas por período, produtos mais vendidos, recorrência, inativos, recompras concluídas, oportunidades perdidas, receita recuperada, taxa de recuperação — exportação CSV (`;` + BOM, proteção contra injeção de fórmula).
- **Configurações**: estabelecimento (com upload de logo), perfil (nome, e-mail, senha), critérios de recompra, modelos de mensagem (criar/editar/excluir/restaurar padrão com pré-visualização), equipe (papéis owner/admin/staff, convites, remoção), privacidade.
- **Planos**: Inicial/Profissional/Premium, trial de 14 dias, limite de clientes e relatórios aplicados no banco, banner de assinatura, modo somente leitura quando expirada.
- **LGPD**: consentimento e oposição ao contato com data, bloqueio de contato no servidor, exportação JSON por cliente, exclusão completa do cliente, exportação CSV da base, solicitação de exclusão do estabelecimento, auditoria sem dados pessoais.
- **Landing page** com as 10 seções, SEO (title, description, Open Graph, canonical, robots.txt, sitemap.xml, URLs amigáveis em português).
- **UX**: skeletons, estados vazios com CTA, erros com "tentar novamente", toasts de sucesso/erro, confirmação antes de excluir, validação de formulário, tabelas que viram cartões no celular, menu lateral + barra inferior móvel, modais em formato bottom-sheet no celular, transições de página.

## 4. Funcionalidades parcialmente concluídas

| Item | Situação |
|---|---|
| Checkout de assinatura | Edge Function `billing-checkout` valida usuário e papel, mas **não chama o gateway** — retorna `BILLING_NOT_CONFIGURED` (sem chave) ou `BILLING_ADAPTER_PENDING` (com chave). Os endpoints do AbacatePay precisam ser integrados a partir da documentação oficial. |
| Webhook de pagamento | Verificação HMAC-SHA256, idempotência e atualização da assinatura implementadas e testadas. O **formato do payload e os nomes de eventos** (`EVENT_TYPE_MAP` em `supabase/functions/_shared/billing.ts`) e o cabeçalho da assinatura precisam ser confirmados com o provedor. |
| Convites de equipe | Convite registrado e aceito automaticamente no login do e-mail convidado; **o e-mail de convite não é enviado** — o admin compartilha o link de cadastro. |
| Exclusão do estabelecimento | A solicitação é registrada (`data_deletion_requests`); o processamento é manual pela equipe VoltaCerta (via service role). |
| Páginas legais | Modelos iniciais — precisam de revisão jurídica. |
| WhatsApp Business Cloud API | Arquitetura preparada (`contact_logs.channel = 'whatsapp_api'`, `external_message_id`); integração não implementada (fora do escopo da v1). |

## 5. Funcionalidades que dependem de credenciais externas

- **Supabase** (obrigatório para tudo além da landing): URL e anon key.
- **SMTP do Supabase Auth** para e-mails de confirmação/recuperação em produção (o SMTP padrão do Supabase tem limite baixo).
- **AbacatePay** (ou outro gateway): API key e segredo de webhook.

## 6. Tabelas criadas

`profiles`, `organizations`, `organization_members`, `organization_invitations`, `subscriptions`, `payment_events`, `customers`, `pets`, `products`, `purchases`, `purchase_items`, `replenishment_predictions`, `message_templates`, `contact_logs`, `audit_logs`, `data_deletion_requests`.
Views (security_invoker): `v_predictions`, `v_customers`.
RPCs: `create_organization`, `accept_pending_invitations`, `update_member_role`, `remove_member`, `create_purchase`, `delete_purchase`, `set_prediction_status`, `log_contact`, `restore_default_templates`, `get_org_context`, `dashboard_metrics`, `get_report`, `export_customer_data`.

## 7. Migrations

| Arquivo | Conteúdo |
|---|---|
| `20261110000001_core_schema.sql` | tipos, perfis, organizações, membros, convites, assinaturas, eventos de pagamento, funções de autorização, RLS |
| `20261110000002_commerce_schema.sql` | clientes, pets, produtos, compras, itens, previsões, modelos, contatos, auditoria, LGPD, RLS |
| `20261110000003_business_logic.sql` | motor de previsão, RPCs, views, indicadores, relatórios, permissões de execução |
| `20261110000004_storage.sql` | bucket `org-logos` e políticas |

**Status:** todas executadas com sucesso em PostgreSQL 18 (PGlite) nos testes. **Pendentes** de aplicação em um projeto Supabase real (não havia credenciais nesta sessão).

## 8. Políticas RLS

RLS habilitado em **todas** as tabelas do schema `public`. Resumo:

| Tabela | SELECT | INSERT/UPDATE | DELETE |
|---|---|---|---|
| profiles | próprio + colegas de organização | próprio | — |
| organizations | membros | owner/admin (update) | — |
| organization_members | membros | só via RPC | só via RPC |
| organization_invitations | owner/admin | owner/admin | owner/admin |
| subscriptions | membros | **ninguém** (service role) | — |
| payment_events | **ninguém** | **ninguém** (service role) | — |
| customers, products | membros | membros + assinatura ativa | owner/admin |
| pets | membros | membros + assinatura ativa | membros |
| purchases, purchase_items, replenishment_predictions, contact_logs | membros | **só via RPC** | só via RPC |
| message_templates | membros | owner/admin | owner/admin |
| audit_logs | owner/admin | só triggers | — |
| data_deletion_requests | owner | owner | — |
| storage `org-logos` | público (leitura) | owner/admin da pasta `{org_id}/` | owner/admin |

O papel `anon` não tem acesso a nenhuma tabela nem RPC.

## 9. Variáveis de ambiente

Frontend (`.env.local`, ver `.env.example`) — **apenas valores públicos**:

| Variável | Descrição |
|---|---|
| `VITE_SUPABASE_URL` | URL do projeto Supabase |
| `VITE_SUPABASE_ANON_KEY` | chave pública anon (segura com RLS) |
| `VITE_APP_URL` | URL pública do app (links de e-mail) |
| `VITE_APP_ENV` | `development` exibe o selo de ambiente de desenvolvimento; use `production` em produção |

Edge Functions (`supabase secrets set …`) — **nunca no frontend**:

| Variável | Descrição |
|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | injetadas automaticamente pelo Supabase |
| `APP_URL` | origem permitida no CORS do checkout |
| `ABACATEPAY_API_KEY` | chave do gateway |
| `BILLING_WEBHOOK_SECRET` | segredo HMAC do webhook |
| `BILLING_SIGNATURE_HEADER` | cabeçalho da assinatura (padrão `x-webhook-signature`; confirmar com o provedor) |
| `BILLING_PROVIDER` | padrão `abacatepay` |

## 10. Executar localmente

```bash
npm install
cp .env.example .env.local   # preencha com seu projeto Supabase
```

Aplicar o banco (escolha uma opção):

```bash
# Projeto na nuvem
npx supabase login
npx supabase link --project-ref SEU_PROJECT_REF
npx supabase db push

# OU Supabase local (requer Docker)
npx supabase start
npx supabase db reset
```

```bash
npm run dev          # http://localhost:5173
npm test             # unitários + integração do banco (não requer Docker)
npm run typecheck
npm run lint
npm run build
```

## 11. Configurar produção

1. Criar projeto Supabase (região São Paulo) e rodar `npx supabase db push`.
2. **Auth → URL Configuration**: Site URL = domínio de produção; Redirect URLs: `https://SEU_DOMINIO/onboarding`, `https://SEU_DOMINIO/redefinir-senha`, `https://SEU_DOMINIO/app/configuracoes/perfil`.
3. **Auth → SMTP**: configurar provedor próprio (Resend, SES, etc.) e personalizar templates em português.
4. **Auth → Providers → Email**: manter confirmação de e-mail ativa; habilitar proteção contra senhas vazadas e CAPTCHA se disponível no plano.
5. Deploy das Edge Functions: `npx supabase functions deploy billing-checkout` e `npx supabase functions deploy billing-webhook --no-verify-jwt`; definir os secrets.
6. Hospedar o frontend (Vercel/Netlify/Cloudflare Pages) com `npm run build` → `dist/`. `vercel.json` e `public/_redirects` já fazem o fallback da SPA e adicionam cabeçalhos de segurança.
7. Definir `VITE_APP_ENV=production` e atualizar o domínio em `index.html` (canonical/OG), `public/robots.txt` e `public/sitemap.xml` (hoje `voltacerta.com.br`).

## 12. Resultado do build

`npm run build` (tsc -b + vite build) — **sucesso**. Bundle dividido: landing/inicial ~270 kB (82 kB gzip) + vendors `react`, `ui`, `supabase`; gráficos (`charts`, 120 kB gzip) e páginas do painel carregados sob demanda.
`npm run typecheck` — sem erros. `npm run lint` — sem erros ou avisos.

## 13. Resultado dos testes

`npm test` — **53 testes, 3 arquivos, todos passando**.

- `tests/db/database.test.ts` (32): executa as migrations reais em PostgreSQL 18 (PGlite) com stub de `auth.uid()`/roles, rodando consultas como `authenticated` sob RLS — onboarding, isolamento entre organizações (leitura, escrita, RPCs, FKs compostas), bloqueio de escrita direta em assinaturas/compras/previsões, deduplicação de telefone, SKU único, permissões por papel, auditoria, cálculo da previsão (base, quantidade, itens repetidos, histórico, outliers, compra retroativa), recompra antecipada sem duplicidade, idempotência, exclusão de compra, estados derivados, contatos e atribuição de venda recuperada, oposição ao contato, rate limit, indicadores, separação valor potencial × receita, restrição de relatórios e de clientes por plano, trial expirado, convites, exportação LGPD.
- `tests/unit/billing.test.ts` (8): assinatura HMAC, comparação em tempo constante, mapeamento de eventos, metadados maliciosos, idempotência de `payment_events`, bloqueio de acesso de usuários.
- `tests/unit/lib.test.ts` (13): link wa.me e variáveis, normalização de telefone, datas no fuso de São Paulo, CSV, tradução de erros, schemas Zod.

**Não testado automaticamente**: fluxo de UI ponta a ponta contra um Supabase real (sem credenciais nesta sessão), Edge Functions em runtime Deno, e-mails do Auth. A landing, o cadastro (validação) e a tela de configuração ausente foram verificados no navegador, em desktop e celular.

## 14. Pendências antes de receber clientes pagantes

1. **Integrar o gateway de pagamento** em `billing-checkout` e confirmar payload/eventos/cabeçalho do webhook com a documentação do AbacatePay; testar em sandbox ponta a ponta.
2. **Rotina de expiração**: hoje o trial vencido é tratado na leitura (`subscription_effective_status`); para `past_due` prolongado, agendar job (pg_cron) que mude para `expired` após a carência definida.
3. Aplicar as migrations em um projeto Supabase real e rodar um teste manual completo (cadastro → onboarding → compra → contato → recompra).
4. SMTP próprio e templates de e-mail em português; envio de e-mail de convite de equipe.
5. Revisão jurídica de Termos e Política de Privacidade; definir DPO/canal de contato LGPD.
6. Processo operacional para solicitações de exclusão de estabelecimento.
7. Monitoramento de erros (ex.: Sentry) e backups/PITR no Supabase.
8. Testes E2E (Playwright) contra um ambiente de staging.
9. Domínio definitivo nas tags de SEO, imagem OG em PNG (algumas redes não renderizam SVG).
