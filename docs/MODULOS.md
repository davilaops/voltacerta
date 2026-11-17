# Módulos de gestão

Funcionalidades adicionadas para competir com sistemas de gestão de pet shop (SimplesVet, Fourpet,
Genix Pet, Spartus Pet), **sem alteração de preços ou planos**: todos os módulos ficam disponíveis
em todos os planos.

| Módulo | Onde fica | Banco (migration) |
|---|---|---|
| Estoque e sugestão de compras | Estoque · Produtos | `0012_inventory` |
| Serviços, profissionais, pacotes e agenda | Serviços e pacotes · Agenda | `0013_services_agenda` |
| Caixa (PDV), financeiro, contas a pagar/receber | Caixa · Financeiro | `0014_finance_pos` |
| Catálogo digital e agendamento online | `/loja/{endereço}` · Configurações → Loja online | `0015_catalog_booking` |
| Lembretes, análise de consumo e segmentos | Lembretes · ficha do cliente · Relatórios | `0016_reminders_insights` |
| WhatsApp automático e nota fiscal | Configurações → Integrações | `0017_integrations` |

Todas as migrations são **aditivas** (nada é apagado). Regras de negócio ficam no banco (RPCs
`SECURITY DEFINER` que validam a associação do usuário à organização), com RLS em todas as tabelas
novas e testes em `tests/db/modules.test.ts`.

## Regras principais

- **Estoque:** só produtos com `track_stock`. A venda baixa o saldo (trigger em `purchase_items`).
  Excluir a venda devolve o estoque. Excluir um cliente (LGPD) não devolve, porque a mercadoria saiu.
  O saldo só muda por movimentação (`stock_adjust` ou trigger), nunca por `UPDATE` direto.
- **Sugestão de compra:** a demanda é o maior valor entre as recompras previstas na janela
  (horizonte + prazo do fornecedor) e a média de vendas dos últimos 90 dias. A quantidade sugerida
  é demanda + estoque mínimo − saldo.
- **Agenda:** o mesmo profissional não pode ter dois atendimentos ao mesmo tempo (validação com lock).
  Concluir um atendimento gera a venda do serviço com pagamento ou consome uma sessão do pacote.
- **Financeiro:** toda venda gera receita em `finance_entries`. Registro, caixa, agenda e pacote
  entram todos. Vendas antigas receberam lançamento "pago / não informado" (backfill).
  Fiado vira conta a receber. O financeiro é visível só a proprietário e administrador.
- **Caixa:** um caixa aberto por loja. Venda no balcão exige caixa aberto e aceita cliente opcional
  e até 5 formas de pagamento. O fechamento compara o dinheiro contado com o esperado
  (abertura + recebimentos em dinheiro − retiradas + reforços).
- **Loja online:** as funções públicas (`public_store`, `public_slots`, `public_request_booking`)
  **não** são executáveis por `anon`. Só a Edge Function `public-store`, com service role, as chama,
  com limite por IP e, no banco, limite por telefone e por loja. A solicitação chega na Agenda como
  "Solicitado online" para o pet shop confirmar.

## Edge Functions novas

| Função | JWT | Uso |
|---|---|---|
| `public-store` | não | Página pública: dados da loja, horários livres e solicitação de agendamento |
| `whatsapp-dispatch` | não (valida dentro) | Envio automático, pelo agendador (`x-cron-secret`) ou pelo painel (JWT de proprietário/administrador) |
| `fiscal-invoice` | sim | Emitir, consultar e cancelar NFC-e e NFS-e (Focus NFe) |

Deploy:

```bash
npx supabase functions deploy public-store --no-verify-jwt --remote=gvhequjdqlmkonsxqmdf
npx supabase functions deploy whatsapp-dispatch --no-verify-jwt --remote=gvhequjdqlmkonsxqmdf
npx supabase functions deploy fiscal-invoice --remote=gvhequjdqlmkonsxqmdf
```

## WhatsApp automático (API oficial da Meta)

Cada pet shop configura em **Configurações → Integrações**:

- o ID do número;
- um token permanente;
- o nome dos modelos aprovados no WhatsApp Manager.

O token fica em `org_integrations`, tabela sem política de leitura para usuários. O painel nunca o
recebe de volta.

Ordem das variáveis em cada modelo:

| Tipo | Variáveis |
|---|---|
| Aniversário | `{{1}}` nome, `{{2}}` pet |
| Pós-venda | `{{1}}` nome |
| Lembrete de agendamento (véspera) | `{{1}}` nome, `{{2}}` pet, `{{3}}` serviço, `{{4}}` data, `{{5}}` hora |
| Retorno de serviço | `{{1}}` nome, `{{2}}` pet, `{{3}}` serviço |
| Pacote vencendo | `{{1}}` nome, `{{2}}` pacote, `{{3}}` data |
| Recompra | `{{1}}` nome, `{{2}}` produto |

Mensagens de relacionamento só vão para clientes com `marketing_consent`. Quem tem `do_not_contact`
nunca recebe. Cada mensagem é enviada uma única vez (`message_dispatches`).

**Envio diário automático (opcional):**

1. Defina o secret `CRON_SECRET` nas Edge Functions.
2. Guarde o mesmo valor no Vault com o nome `cron_secret`.
3. Agende no SQL Editor:

```sql
select cron.schedule('whatsapp-diario', '0 12 * * *', $$
  select net.http_post(
    url := 'https://gvhequjdqlmkonsxqmdf.supabase.co/functions/v1/whatsapp-dispatch',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    body := '{}'::jsonb)
$$);
```

O horário é em UTC: 12h UTC equivale a 9h em Brasília. Sem o agendador, o botão
"Enviar pendentes agora" faz o mesmo sob demanda.

## Nota fiscal (Focus NFe)

- **NFC-e (produtos):** emissão síncrona, `POST /v2/nfce?ref=`. Exige NCM em cada produto.
  O CFOP padrão é 5102 e o CSOSN padrão é 102.
- **NFS-e (serviços):** assíncrona, `POST /v2/nfse?ref=` seguida de consulta. Exige inscrição
  municipal e o código IBGE do município. O item padrão é LC 116 05.08.
- Autenticação HTTP Basic, com o token da empresa como usuário. Ambientes: homologação
  (`homologacao.focusnfe.com.br`) e produção (`api.focusnfe.com.br`).
- O PIX usa o código `17` da tabela tPag da SEFAZ (NT 2020.006).
- A NFC-e só pode ser cancelada até 30 minutos após a emissão. A justificativa deve ter de
  15 a 255 caracteres.
- Cada pet shop precisa de CNPJ, certificado A1 e cadastro na Focus.
- A configuração tributária deve ser validada pelo contador do pet shop.
