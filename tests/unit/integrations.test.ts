import { describe, expect, it, vi } from 'vitest'
import { buildTemplateBody, firstName, paramValues, sendTemplate, toE164, type PendingMessage } from '../../supabase/functions/_shared/whatsapp.ts'
import { buildNfce, buildNfse, focus, nowBrazilISO, parseFocus, splitDiscount, type FiscalSettings, type Prepared } from '../../supabase/functions/_shared/fiscal.ts'

const msg = (over: Partial<PendingMessage> = {}): PendingMessage => ({
  dedupe_key: 'agenda:1', kind: 'lembrete_agendamento', customer_id: 'c1', customer_name: 'Maria Souza', phone: '5511988887777',
  pet_name: 'Thor', service_name: 'Banho', product_name: null, prediction_id: null, date: '10/12', time: '14:30',
  template: { name: 'lembrete_agenda', language: 'pt_BR' }, ...over,
})

describe('WhatsApp Cloud API', () => {
  it('monta o corpo do modelo com variáveis na ordem documentada', () => {
    const body = buildTemplateBody(msg())!
    expect(body.to).toBe('+5511988887777')
    expect(body.type).toBe('template')
    expect(body.template.name).toBe('lembrete_agenda')
    expect(body.template.components[0].parameters.map((p) => p.text)).toEqual(['Maria', 'Thor', 'Banho', '10/12', '14:30'])
  })
  it('usa valores padrão quando falta pet/serviço e recusa telefone inválido', () => {
    expect(paramValues(msg({ kind: 'aniversario', pet_name: null }))).toEqual(['Maria', 'seu pet'])
    expect(toE164('123')).toBeNull()
    expect(buildTemplateBody(msg({ phone: '119888' }))).toBeNull()
    expect(buildTemplateBody(msg({ template: null }))).toBeNull()
    expect(firstName('  ')).toBe('cliente')
  })
  it('interpreta sucesso e erro da API', async () => {
    const ok = vi.fn().mockResolvedValue(new Response(JSON.stringify({ messages: [{ id: 'wamid.X' }] }), { status: 200 }))
    expect(await sendTemplate('123', 'tok', {}, ok as unknown as typeof fetch)).toEqual({ ok: true, id: 'wamid.X' })
    expect(ok.mock.calls[0][0]).toMatch(/^https:\/\/graph\.facebook\.com\/v\d+\.0\/123\/messages$/)
    expect(ok.mock.calls[0][1].headers.Authorization).toBe('Bearer tok')
    const bad = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { message: '(#132001) Template name does not exist', code: 132001, error_data: { details: 'no template' } },
    }), { status: 400 }))
    const r = await sendTemplate('123', 'tok', {}, bad as unknown as typeof fetch)
    expect(r).toMatchObject({ ok: false, code: 132001 })
    expect(!r.ok && r.error).toContain('no template')
  })
})

const settings: FiscalSettings = {
  fiscal_environment: 'homologacao', fiscal_token: 'tok', fiscal_cnpj: '12345678000195', fiscal_im: '998877',
  fiscal_city_code: '3550308', fiscal_simples: true, fiscal_icms_situation: '102', fiscal_service_item: '05.08',
  fiscal_municipal_tax_code: null, fiscal_iss_rate: 2,
}
const prep: Prepared = {
  organization_id: 'o1',
  purchase: { id: 'abcdef12-0000-0000-0000-000000000000', date: '2026-11-17', subtotal: 300, discount: 30, total: 270 },
  customer: { name: 'João Cliente', email: 'joao@x.com', phone: '5511977776666' },
  items: [
    { code: 'R15', name: 'Ração 15kg', ncm: '23091000', cfop: '5102', origin: 0, unit: 'un', quantity: 1, unit_price: 200, gross: 200, discount: 0 },
  ],
  services: [{ description: 'Banho', quantity: 1, total: 100 }],
  payments: [{ method: 'pix', amount: 270 }],
}

describe('Nota fiscal (Focus NFe)', () => {
  it('rateia o desconto geral sem perder centavos', () => {
    expect(splitDiscount([200, 100], 30)).toEqual([20, 10])
    const parts = splitDiscount([10, 10, 10], 10)
    expect(parts.reduce((a, b) => a + b, 0)).toBeCloseTo(10, 5)
    expect(splitDiscount([50], 0)).toEqual([0])
  })
  it('NFC-e: só produtos, desconto rateado e pagamento ajustado ao total da nota', () => {
    const { body, total } = buildNfce(prep, settings, { cpf: '123.456.789-09', now: new Date('2026-11-17T15:00:00Z') })
    expect(total).toBe(180) // 200 − 20 de desconto rateado (o serviço vai na NFS-e)
    expect(body.cnpj_emitente).toBe('12345678000195')
    expect(body.data_emissao).toBe('2026-11-17T12:00:00-03:00')
    expect(body.items[0]).toMatchObject({ codigo_ncm: '23091000', cfop: '5102', unidade_comercial: 'UN', valor_bruto: 200, valor_desconto: 20, icms_situacao_tributaria: '102' })
    expect(body.formas_pagamento).toEqual([{ forma_pagamento: '17', valor_pagamento: 180 }])
    expect(body.cpf_destinatario).toBe('12345678909')
  })
  it('NFS-e: valor dos serviços com desconto e dados do prestador', () => {
    const { body, total } = buildNfse(prep, settings)
    expect(total).toBe(90)
    expect(body.prestador).toEqual({ cnpj: '12345678000195', inscricao_municipal: '998877', codigo_municipio: '3550308' })
    expect(body.servico).toMatchObject({ valor_servicos: 90, item_lista_servico: '05.08', aliquota: 2, iss_retido: false, discriminacao: 'Banho' })
    expect(body.tomador).toMatchObject({ razao_social: 'João Cliente', email: 'joao@x.com', telefone: '11977776666' })
  })
  it('interpreta respostas e monta URLs absolutas', () => {
    const ok = parseFocus('nfce', 'homologacao', 201, { status: 'autorizado', numero: 12, serie: '1', chave_nfe: 'NFe351', caminho_danfe: '/arquivos/x.html', caminho_xml_nota_fiscal: '/arquivos/x.xml' })
    expect(ok).toMatchObject({ status: 'autorizado', numero: '12', chave: 'NFe351', url_pdf: 'https://homologacao.focusnfe.com.br/arquivos/x.html' })
    expect(parseFocus('nfce', 'producao', 422, { status: 'erro_autorizacao', mensagem_sefaz: 'Rejeição: NCM inexistente' }))
      .toMatchObject({ status: 'erro', message: 'Rejeição: NCM inexistente' })
    expect(parseFocus('nfse', 'producao', 202, { status: 'processando_autorizacao' }).status).toBe('processando')
    expect(parseFocus('nfse', 'producao', 400, { erros: [{ mensagem: 'Município não informado' }] }))
      .toMatchObject({ status: 'erro', message: 'Município não informado' })
    expect(nowBrazilISO(new Date('2026-01-01T02:30:00Z'))).toBe('2025-12-31T23:30:00-03:00')
  })
  it('autentica com Basic (token como usuário, senha vazia)', async () => {
    const f = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    await focus('producao', 'abc', 'GET', '/v2/nfce/ref1', undefined, f as unknown as typeof fetch)
    expect(f.mock.calls[0][0]).toBe('https://api.focusnfe.com.br/v2/nfce/ref1')
    expect(f.mock.calls[0][1].headers.Authorization).toBe('Basic ' + btoa('abc:'))
  })
})
