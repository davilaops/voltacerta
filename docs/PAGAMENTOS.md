# Pagamentos

Gateway ativo: **Asaas** (API v3), escolhido porque aceita conta de pessoa física (CPF). A billing-checkout usa o Asaas sempre que `ASAAS_API_KEY` estiver configurada. Sem ela, volta para a AbacatePay (seção mais abaixo, mantida como legado).

## Asaas

### Como funciona
1. O proprietário clica em **Assinar**. Na primeira vez, o app pede o **CPF ou CNPJ**, porque o Asaas exige o documento para criar o cliente.
2. A função `billing-checkout`:
   - valida o login e o papel `owner`;
   - lê o preço em `plans`;
   - cria o cliente no Asaas, ou reaproveita o já criado;
   - grava `billing_checkouts`;
   - cria a **assinatura mensal** (`POST /v3/subscriptions`, `externalReference` = id do checkout, 1ª cobrança vencendo hoje);
   - devolve a **fatura** da primeira cobrança (`invoiceUrl`), onde a pessoa paga com Pix, cartão ou boleto.
3. O Asaas chama a função `asaas-webhook`. Ela confere o header `asaas-access-token` (igual a `BILLING_WEBHOOK_SECRET`) e aplica o evento por `billing_apply_event()`, de forma idempotente.

| Evento do Asaas | Efeito |
|---|---|
| `PAYMENT_CONFIRMED` / `PAYMENT_RECEIVED` (cobrança de assinatura) | assinatura `active`, período +1 mês, linha em `payments`. O "recebido" de um pagamento já confirmado não estende o período de novo. |
| `PAYMENT_OVERDUE`, `PAYMENT_CREDIT_CARD_CAPTURE_REFUSED`, `PAYMENT_REPROVED_BY_RISK_ANALYSIS` | `past_due`, somente se for a assinatura vigente |
| `PAYMENT_REFUNDED` | pagamento `refunded` |
| `SUBSCRIPTION_DELETED` / `SUBSCRIPTION_INACTIVATED` | `canceled`, com acesso até o fim do período pago |
| demais | registrados e ignorados |

Proteções extras:
- Clicar em Assinar de novo **reaproveita** a fatura pendente do mesmo plano.
- Uma cobrança abandonada de outro plano é removida no Asaas.
- Se a 1ª cobrança vencer sem pagamento, a assinatura é removida automaticamente para não gerar novas faturas.

### Configuração
1. **Chave de API** em *Integrações → Chaves de API*. No Supabase, vá em *Edge Functions → Secrets* e crie `ASAAS_API_KEY`.
   - Chaves de sandbox contêm `_hmlg_`; as de produção, `_prod_`.
   - Se a chave não tiver esse marcador, defina `ASAAS_ENV=sandbox` ou `ASAAS_ENV=production`.
2. **Webhook** em *Integrações → Webhooks → Adicionar*:
   - **URL:** `https://gvhequjdqlmkonsxqmdf.supabase.co/functions/v1/asaas-webhook`
   - **Token de autenticação:** o mesmo valor de `BILLING_WEBHOOK_SECRET`
   - **Versão da API:** v3. **Tipo de envio:** sequencial.
   - **Eventos:** Cobranças (`PAYMENT_CONFIRMED`, `PAYMENT_RECEIVED`, `PAYMENT_OVERDUE`, `PAYMENT_REFUNDED`, `PAYMENT_CREDIT_CARD_CAPTURE_REFUSED`, `PAYMENT_REPROVED_BY_RISK_ANALYSIS`) e Assinaturas (`SUBSCRIPTION_DELETED`, `SUBSCRIPTION_INACTIVATED`).
3. Opcional: `ASAAS_BILLING_TYPE`. O padrão `UNDEFINED` deixa a pessoa escolher Pix, cartão ou boleto. Também aceita `PIX`, `CREDIT_CARD` ou `BOLETO`.
4. **Retorno automático ao app** depois do pagamento: o Asaas só redireciona para o domínio cadastrado em *Minha Conta → Informações → Site*. Sem isso, a assinatura é criada sem redirecionamento, e a pessoa volta ao app manualmente.
5. **Produção:** troque `ASAAS_API_KEY` pela chave de produção e crie o mesmo webhook na conta de produção. Eventos de sandbox nunca liberam checkouts de produção (`ENVIRONMENT_MISMATCH`).

---

# AbacatePay (legado, API v2)

Assinatura mensal recorrente pelos planos de `public.plans`. O pagamento acontece no checkout hospedado da AbacatePay. **Somente o webhook autenticado ativa um plano**; o navegador nunca marca nada como pago.

## Como funciona

1. O proprietário clica em **Assinar** em *Plano e assinatura*.
2. A Edge Function `billing-checkout` faz o seguinte:
   - valida o login e o papel `owner`, usando a RLS;
   - lê o preço em `plans`;
   - cria ou reaproveita o produto mensal na AbacatePay e cria o cliente;
   - grava o vínculo `checkout → estabelecimento` em `billing_checkouts`;
   - chama `POST /v2/subscriptions/create` e devolve a URL de pagamento.
3. A pessoa paga e volta para `/app/plano?pagamento=concluido`. A tela fica atualizando até a confirmação chegar.
4. A AbacatePay chama o `billing-webhook`, que faz o seguinte:
   - confere o **segredo** (`X-Webhook-Secret`) e a **assinatura** (`X-Webhook-Signature`, HMAC-SHA256 em base64);
   - normaliza o evento e chama `billing_apply_event()`, que aplica tudo numa única transação e é idempotente pelo id do evento.

| Evento da AbacatePay | Efeito |
|---|---|
| `subscription.completed` / `subscription.renewed` (pagamento `PAID`/`APPROVED`) | assinatura `active` no plano do checkout, período +1 mês, linha em `payments` |
| `subscription.payment_failed` | `past_due`, pagamento `failed` |
| `subscription.cancelled` | `canceled`; o acesso continua até o fim do período pago |
| `checkout.refunded` (assinatura) | pagamento `refunded` |
| `checkout.completed` e demais | registrados e ignorados (evita contar o ciclo duas vezes) |

Proteções:
- Evento de **modo teste** não libera checkout de **produção**, e vice-versa (`ENVIRONMENT_MISMATCH`).
- Checkout desconhecido não altera nada (`ORGANIZATION_NOT_IDENTIFIED`).
- Assinatura paga em vigor bloqueia um segundo checkout, para evitar cobrança dupla.
- Período vencido sem renovação vira `past_due` após 3 dias e `expired` (somente leitura) após 10 dias.

## Configuração (uma vez)

### 1. Conta e chave na AbacatePay
1. Crie a conta em https://app.abacatepay.com e ligue o **Modo Teste** para começar.
2. Vá em **Integração → API → Criar chave**, versão **v2**, com as permissões `PRODUCT:CREATE`, `CUSTOMER:CREATE` e `SUBSCRIPTION:CREATE`. A chave de teste começa com `abc_dev_`.

### 2. Segredos no Supabase (nunca no frontend nem no git)
Gere um segredo forte, com 32 caracteres ou mais, para o webhook. A chave pública de assinatura da AbacatePay já está no código (`billing-webhook`) (não precisa de secret).

```bash
npx supabase secrets set --remote=gvhequjdqlmkonsxqmdf ABACATEPAY_API_KEY=abc_dev_xxx BILLING_WEBHOOK_SECRET=seu-segredo-longo APP_URL=http://localhost:5173
```

`APP_URL` aceita várias origens separadas por vírgula (ex.: `https://voltacerta-brown.vercel.app,http://localhost:5173`); o retorno do checkout volta para a origem que fez a chamada.

Opcional: `BILLING_METHODS=CARD,PIX`. O padrão é `CARD`. Na assinatura, `PIX` significa Pix Automático e precisa estar habilitado na sua conta.

### 3. Publicar as Edge Functions
```bash
npx supabase functions deploy billing-checkout --remote=gvhequjdqlmkonsxqmdf
```
```bash
npx supabase functions deploy billing-webhook --no-verify-jwt --remote=gvhequjdqlmkonsxqmdf
```

### 4. Webhook na AbacatePay
Vá em **Integração → Webhooks → Criar webhook** e escolha **Webhook v2**:
- **URL:** `https://gvhequjdqlmkonsxqmdf.supabase.co/functions/v1/billing-webhook`
- **Secret:** o mesmo valor de `BILLING_WEBHOOK_SECRET`
- **Eventos:** `subscription.completed`, `subscription.renewed`, `subscription.payment_failed`, `subscription.cancelled`, `checkout.refunded`

Um webhook criado em modo teste recebe apenas eventos de teste.

### 5. Testar
1. Entre no app como proprietário, abra **Plano e assinatura → Assinar**.
2. No checkout de teste, use o cartão `4242 4242 4242 4242` (qualquer validade futura e qualquer CVV) ou o botão **Simular Pagamento**.
3. Ao voltar, a situação deve mudar para **Ativa**. Confira em **Admin → Assinaturas → Pagamentos** e em `payment_events` (a coluna `error` deve estar vazia).

### Permissões da chave
Inclua também `SUBSCRIPTION:DELETE` na chave (teste e produção): é usada pelo botão **Encerrar assinatura** do painel admin (Edge Function `admin-cancel-subscription`), que cancela na AbacatePay antes de encerrar no banco.

### 6. Produção
1. Crie uma chave `abc_prod_` e um webhook novo **fora** do Modo Teste.
2. Troque os segredos: `ABACATEPAY_API_KEY=abc_prod_...` e `APP_URL=https://app.voltacerta.com.br`.
3. Os produtos de produção são criados automaticamente na primeira assinatura. O cache fica em `plans.provider_products.prod`.
4. Se o preço de um plano mudar no Admin, um produto novo é criado no próximo checkout. Assinaturas já existentes mantêm o preço antigo.

## Limitações conhecidas
- **Troca de plano** com assinatura paga ativa: hoje o app pede para falar com o suporte. O cancelamento e a troca são feitos no painel da AbacatePay, e o webhook atualiza o app.
- `currentPeriodEnd` não vem nos webhooks. O período é calculado como data do pagamento + 1 mês.
- A AbacatePay não documenta que a `metadata` volta no webhook. Por isso o vínculo fica em `billing_checkouts`, no nosso banco.
