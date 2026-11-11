# Pagamentos — AbacatePay (API v2)

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

### 6. Produção
1. Crie uma chave `abc_prod_` e um webhook novo **fora** do Modo Teste.
2. Troque os segredos: `ABACATEPAY_API_KEY=abc_prod_...` e `APP_URL=https://app.voltacerta.com.br`.
3. Os produtos de produção são criados automaticamente na primeira assinatura. O cache fica em `plans.provider_products.prod`.
4. Se o preço de um plano mudar no Admin, um produto novo é criado no próximo checkout. Assinaturas já existentes mantêm o preço antigo.

## Limitações conhecidas
- **Troca de plano** com assinatura paga ativa: hoje o app pede para falar com o suporte. O cancelamento e a troca são feitos no painel da AbacatePay, e o webhook atualiza o app.
- `currentPeriodEnd` não vem nos webhooks. O período é calculado como data do pagamento + 1 mês.
- A AbacatePay não documenta que a `metadata` volta no webhook. Por isso o vínculo fica em `billing_checkouts`, no nosso banco.
