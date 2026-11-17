// Nota fiscal via Focus NFe (API v2) — https://doc.focusnfe.com.br
// Autenticação: HTTP Basic com o token da empresa como usuário e senha vazia.
// NFC-e (produtos, modelo 65): emissão síncrona  POST /v2/nfce?ref=REF
// NFS-e (serviços):             emissão assíncrona POST /v2/nfse?ref=REF, consulta GET /v2/nfse/REF
export const FOCUS_BASE = {
  homologacao: 'https://homologacao.focusnfe.com.br',
  producao: 'https://api.focusnfe.com.br',
} as const
export type FiscalEnv = keyof typeof FOCUS_BASE

export interface FiscalSettings {
  fiscal_environment: FiscalEnv
  fiscal_token: string
  fiscal_cnpj: string
  fiscal_im: string | null
  fiscal_city_code: string | null
  fiscal_simples: boolean
  fiscal_icms_situation: string
  fiscal_service_item: string
  fiscal_municipal_tax_code: string | null
  fiscal_iss_rate: number | null
}

export interface Prepared {
  organization_id: string
  purchase: { id: string; date: string; subtotal: number; discount: number; total: number }
  customer: { name: string; email: string | null; phone: string | null } | null
  items: { code: string; name: string; ncm: string; cfop: string; origin: number; unit: string; quantity: number; unit_price: number; gross: number; discount: number }[]
  services: { description: string; quantity: number; total: number }[]
  payments: { method: string; amount: number }[]
}

const UNIT: Record<string, string> = { kg: 'KG', g: 'G', l: 'L', ml: 'ML', un: 'UN', cx: 'CX', pct: 'PCT' }
// Tabela de meios de pagamento da NFC-e (tPag). 17 = PIX (NT 2020.006).
const PAYMENT_CODE: Record<string, string> = {
  dinheiro: '01', cartao_credito: '03', cartao_debito: '04', fiado: '05', boleto: '15', pix: '17',
  transferencia: '18', outro: '99', nao_informado: '99',
}

const r2 = (v: number) => Math.round(v * 100) / 100

/** Data/hora atual no fuso de Brasília em ISO 8601 (a Focus aceita até 5 min de diferença). */
export function nowBrazilISO(now = new Date()): string {
  const local = new Date(now.getTime() - 3 * 3600_000)
  return local.toISOString().slice(0, 19) + '-03:00'
}

/** Rateia o desconto geral da venda entre os itens (o último absorve o arredondamento). */
export function splitDiscount(grossList: number[], discount: number): number[] {
  const total = grossList.reduce((s, v) => s + v, 0)
  if (!discount || total <= 0) return grossList.map(() => 0)
  const parts = grossList.map((g) => r2((g / total) * discount))
  const diff = r2(discount - parts.reduce((s, v) => s + v, 0))
  parts[parts.length - 1] = r2(parts[parts.length - 1] + diff)
  return parts
}

export function onlyDigits(v: string | null | undefined): string {
  return (v ?? '').replace(/\D/g, '')
}

export function buildNfce(p: Prepared, s: FiscalSettings, opts: { cpf?: string | null; now?: Date } = {}) {
  const allGross = [...p.items.map((i) => i.gross - i.discount), ...p.services.map((x) => x.total)]
  const general = splitDiscount(allGross, Number(p.purchase.discount))
  const items = p.items.map((i, idx) => {
    const desc = r2(Number(i.discount) + general[idx])
    return {
      numero_item: idx + 1,
      codigo_produto: i.code.slice(0, 60),
      descricao: i.name.slice(0, 120),
      codigo_ncm: i.ncm,
      cfop: i.cfop,
      unidade_comercial: UNIT[i.unit] ?? 'UN',
      quantidade_comercial: Number(i.quantity),
      valor_unitario_comercial: Number(i.unit_price),
      valor_bruto: r2(Number(i.gross)),
      unidade_tributavel: UNIT[i.unit] ?? 'UN',
      quantidade_tributavel: Number(i.quantity),
      valor_unitario_tributavel: Number(i.unit_price),
      icms_origem: Number(i.origin),
      icms_situacao_tributaria: s.fiscal_icms_situation,
      ...(desc > 0 ? { valor_desconto: desc } : {}),
    }
  })
  const nfceTotal = r2(items.reduce((sum, i) => sum + i.valor_bruto - (i.valor_desconto ?? 0), 0))
  const pays = p.payments.filter((x) => Number(x.amount) > 0)
  const paySum = r2(pays.reduce((sum, x) => sum + Number(x.amount), 0))
  const formas = pays.length && Math.abs(paySum - nfceTotal) < 0.01
    ? pays.map((x) => ({ forma_pagamento: PAYMENT_CODE[x.method] ?? '99', valor_pagamento: r2(Number(x.amount)) }))
    : [{ forma_pagamento: PAYMENT_CODE[pays[0]?.method ?? 'outro'] ?? '99', valor_pagamento: nfceTotal }]
  const cpf = onlyDigits(opts.cpf)
  return {
    total: nfceTotal,
    body: {
      cnpj_emitente: s.fiscal_cnpj,
      data_emissao: nowBrazilISO(opts.now),
      natureza_operacao: 'Venda ao consumidor',
      presenca_comprador: '1',
      modalidade_frete: '9',
      local_destino: '1',
      ...(cpf.length === 11 ? { cpf_destinatario: cpf, ...(p.customer?.name ? { nome_destinatario: p.customer.name.slice(0, 60) } : {}) } : {}),
      items,
      formas_pagamento: formas,
    },
  }
}

export function buildNfse(p: Prepared, s: FiscalSettings, opts: { cpf?: string | null; now?: Date } = {}) {
  const allGross = [...p.items.map((i) => i.gross - i.discount), ...p.services.map((x) => x.total)]
  const general = splitDiscount(allGross, Number(p.purchase.discount))
  const offset = p.items.length
  const value = r2(p.services.reduce((sum, x, idx) => sum + Number(x.total) - general[offset + idx], 0))
  const cpf = onlyDigits(opts.cpf)
  const tomador: Record<string, unknown> = { razao_social: (p.customer?.name ?? 'Consumidor final').slice(0, 115) }
  if (cpf.length === 11) tomador.cpf = cpf
  if (cpf.length === 14) tomador.cnpj = cpf
  if (p.customer?.email) tomador.email = p.customer.email.slice(0, 80)
  if (p.customer?.phone) tomador.telefone = onlyDigits(p.customer.phone).replace(/^55/, '')
  return {
    total: value,
    body: {
      data_emissao: nowBrazilISO(opts.now),
      natureza_operacao: '1',
      optante_simples_nacional: s.fiscal_simples,
      prestador: {
        cnpj: s.fiscal_cnpj,
        inscricao_municipal: s.fiscal_im ?? '',
        codigo_municipio: s.fiscal_city_code ?? '',
      },
      tomador,
      servico: {
        valor_servicos: value,
        iss_retido: false,
        item_lista_servico: s.fiscal_service_item,
        ...(s.fiscal_municipal_tax_code ? { codigo_tributario_municipio: s.fiscal_municipal_tax_code } : {}),
        ...(s.fiscal_iss_rate != null ? { aliquota: Number(s.fiscal_iss_rate) } : {}),
        discriminacao: p.services.map((x) => `${x.description}${Number(x.quantity) !== 1 ? ` (x${x.quantity})` : ''}`).join('; ').slice(0, 2000),
        codigo_municipio: s.fiscal_city_code ?? '',
      },
    },
  }
}

export type InvoiceStatus = 'processando' | 'autorizado' | 'erro' | 'cancelado'
export interface InvoiceResult {
  status: InvoiceStatus
  numero: string | null
  serie: string | null
  chave: string | null
  url_pdf: string | null
  url_xml: string | null
  message: string | null
}

// deno-lint-ignore no-explicit-any
export function parseFocus(kind: 'nfce' | 'nfse', env: FiscalEnv, httpStatus: number, data: any): InvoiceResult {
  const base = FOCUS_BASE[env]
  const abs = (path: unknown) => (typeof path === 'string' && path ? (path.startsWith('http') ? path : base + path) : null)
  const st = String(data?.status ?? '')
  const status: InvoiceStatus =
    st === 'autorizado' ? 'autorizado'
      : st === 'cancelado' ? 'cancelado'
        : st === 'processando_autorizacao' ? 'processando'
          : httpStatus >= 400 || st.startsWith('erro') || st === 'denegado' ? 'erro'
            : 'processando'
  const errors = Array.isArray(data?.erros) ? data.erros.map((e: { mensagem?: string }) => e.mensagem).filter(Boolean).join('; ') : ''
  const message = (data?.mensagem_sefaz ?? (errors || data?.mensagem) ?? null) as string | null
  return {
    status,
    numero: data?.numero != null ? String(data.numero) : null,
    serie: data?.serie != null ? String(data.serie) : null,
    chave: (kind === 'nfce' ? data?.chave_nfe : data?.codigo_verificacao) ?? null,
    url_pdf: kind === 'nfce' ? abs(data?.caminho_danfe) : (abs(data?.url_danfse) ?? abs(data?.url)),
    url_xml: abs(data?.caminho_xml_nota_fiscal),
    message: message ? String(message).slice(0, 1000) : null,
  }
}

export async function focus(
  env: FiscalEnv, token: string, method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown, fetchImpl: typeof fetch = fetch,
  // deno-lint-ignore no-explicit-any
): Promise<{ status: number; data: any }> {
  const res = await fetchImpl(FOCUS_BASE[env] + path, {
    method,
    headers: { Authorization: 'Basic ' + btoa(`${token}:`), 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  return { status: res.status, data }
}
