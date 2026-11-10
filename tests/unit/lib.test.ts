import { describe, expect, it } from 'vitest'
import { buildWhatsAppLink, renderTemplate } from '@/lib/whatsapp'
import { normalizePhone } from '@/lib/phone'
import { addDaysISO, diffDaysISO, isValidPeriod, periodFromPreset, todayISO } from '@/lib/dates'
import { toCsv } from '@/lib/csv'
import { errorMessage } from '@/lib/errors'
import { formatPhone } from '@/lib/format'
import { customerSchema } from '@/features/customers/schemas'
import { productSchema } from '@/features/products/api'

describe('WhatsApp', () => {
  it('substitui variáveis usando o primeiro nome', () => {
    const out = renderTemplate('Olá, {nome}! Precisa repor {produto} para {pet}?', { nome: 'Maria da Silva', produto: 'Ração 15kg', pet: 'Thor' })
    expect(out).toBe('Olá, Maria! Precisa repor Ração 15kg para Thor?')
  })
  it('usa textos neutros quando faltam dados', () => {
    expect(renderTemplate('{produto} / {pet}', { nome: 'Ana' })).toBe('seus produtos / seu pet')
  })
  it('gera link wa.me com DDI e mensagem codificada', () => {
    const link = buildWhatsAppLink('(11) 98888-7777', 'Olá, Ana! Ração & areia? 100%')
    expect(link).toBe('https://wa.me/5511988887777?text=' + encodeURIComponent('Olá, Ana! Ração & areia? 100%'))
    expect(decodeURIComponent(link!.split('text=')[1])).toBe('Olá, Ana! Ração & areia? 100%')
  })
  it('retorna null sem telefone válido', () => {
    expect(buildWhatsAppLink(null, 'x')).toBeNull()
    expect(buildWhatsAppLink('123', 'x')).toBeNull()
  })
})

describe('telefone', () => {
  it('normaliza no mesmo formato do banco', () => {
    expect(normalizePhone('(21) 98888-7777')).toBe('5521988887777')
    expect(normalizePhone('+55 21 98888-7777')).toBe('5521988887777')
    expect(normalizePhone('021 3333-4444')).toBe('552133334444')
    expect(normalizePhone('')).toBeNull()
    expect(normalizePhone('12345')).toBeNull()
  })
  it('formata para exibição', () => {
    expect(formatPhone('5511988887777')).toBe('(11) 98888-7777')
    expect(formatPhone('551133334444')).toBe('(11) 3333-4444')
  })
})

describe('datas locais brasileiras', () => {
  it('usa o fuso de São Paulo, não UTC', () => {
    // 02:30 UTC de 10/11 = 23:30 de 09/11 em São Paulo
    expect(todayISO('America/Sao_Paulo', new Date('2026-11-10T02:30:00Z'))).toBe('2026-11-09')
    expect(todayISO('UTC', new Date('2026-11-10T02:30:00Z'))).toBe('2026-11-10')
  })
  it('soma e compara dias sem deslocamento', () => {
    expect(addDaysISO('2026-02-27', 2)).toBe('2026-03-01')
    expect(diffDaysISO('2026-03-01', '2026-02-27')).toBe(2)
  })
  it('presets de período', () => {
    expect(periodFromPreset('7d', '2026-11-10')).toEqual({ preset: '7d', from: '2026-11-04', to: '2026-11-10' })
    expect(periodFromPreset('30d', '2026-11-10').from).toBe('2026-10-12')
    expect(isValidPeriod({ from: '2026-11-10', to: '2026-11-01' })).toBe(false)
    expect(isValidPeriod({ from: '2024-01-01', to: '2026-01-01' })).toBe(false)
  })
})

describe('CSV', () => {
  it('usa ; e BOM, escapa aspas e evita injeção de fórmula', () => {
    const csv = toCsv([{ a: 'x;y', b: '=SUM(A1)', c: 'diz "oi"' }], [
      { key: 'a', label: 'A' },
      { key: 'b', label: 'B' },
      { key: 'c', label: 'C' },
    ])
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    const [, line] = csv.slice(1).split('\r\n')
    expect(line).toBe(`"x;y";'=SUM(A1);"diz ""oi"""`)
  })
})

describe('mensagens de erro', () => {
  it('traduz códigos do servidor', () => {
    expect(errorMessage({ message: 'PLAN_LIMIT_CUSTOMERS' })).toMatch(/limite de clientes/)
    expect(errorMessage({ message: 'duplicate key value violates unique constraint "customers_org_phone_uq"', code: '23505' })).toMatch(/telefone/)
    expect(errorMessage({ message: 'new row violates row-level security policy' })).toMatch(/permissão/)
    expect(errorMessage({ message: 'Invalid login credentials' })).toBe('E-mail ou senha incorretos.')
  })
})

describe('validação de formulários', () => {
  it('cliente exige nome e telefone válido quando informado', () => {
    const base = { full_name: 'Ana Lima', phone: '', email: '', notes: '', marketing_consent: false, do_not_contact: false }
    expect(customerSchema.safeParse(base).success).toBe(true)
    expect(customerSchema.safeParse({ ...base, phone: '123' }).success).toBe(false)
    expect(customerSchema.safeParse({ ...base, full_name: 'A' }).success).toBe(false)
    expect(customerSchema.safeParse({ ...base, email: 'invalido' }).success).toBe(false)
  })
  it('produto converte valores em formato brasileiro', () => {
    const r = productSchema.safeParse({ name: 'Ração', category: 'racoes', price: '1.234,50', cost: '', size_value: '15', unit: 'kg', avg_duration_days: '35', active: true })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.price).toBe(1234.5)
      expect(r.data.cost).toBeNull()
      expect(r.data.avg_duration_days).toBe(35)
    }
    expect(productSchema.safeParse({ name: 'Ração', category: 'racoes', price: '10', unit: 'kg', avg_duration_days: '0', active: true }).success).toBe(false)
  })
})
