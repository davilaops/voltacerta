import { describe, expect, it } from 'vitest'
import {
  BUSINESS_TYPES, businessGroup, businessTypeLabel, mergeOptions, productCategoryLabel, professionalRoleLabel,
  serviceCategoryLabel, suggestionsFor, toStoredProductCategory, toStoredProfessionalRole, toStoredServiceCategory,
} from '@/domain/business'

describe('ramos de estabelecimento', () => {
  it('códigos são únicos e válidos para o banco (^[a-z][a-z_]{1,39}$)', () => {
    const values = BUSINESS_TYPES.map((t) => t.value)
    expect(new Set(values).size).toBe(values.length)
    for (const v of values) expect(v).toMatch(/^[a-z][a-z_]{1,39}$/)
  })

  it('mantém os ramos antigos de pet shop', () => {
    for (const v of ['pet_shop', 'loja_racao', 'veterinario', 'delivery', 'rede', 'outro']) expect(BUSINESS_TYPES.some((t) => t.value === v)).toBe(true)
    expect(businessGroup('pet_shop')).toBe('pet')
  })

  it('ramo desconhecido ou vazio cai nas sugestões gerais', () => {
    expect(businessGroup(null)).toBe('geral')
    expect(businessGroup('algo_novo')).toBe('geral')
    expect(businessTypeLabel('algo_novo')).toBe('algo_novo')
    expect(businessTypeLabel(null)).toBeNull()
  })

  it('sugere categorias do ramo', () => {
    expect(suggestionsFor('barbearia').services).toContain('Corte')
    expect(suggestionsFor('oficina').services).toContain('Troca de óleo')
    expect(suggestionsFor('pet_shop').products).toContain('Rações')
  })
})

describe('categorias livres', () => {
  it('exibe códigos antigos pelo nome e texto livre como está', () => {
    expect(productCategoryLabel('racoes')).toBe('Rações')
    expect(productCategoryLabel('Roupas')).toBe('Roupas')
    expect(serviceCategoryLabel('banho_tosa')).toBe('Banho e tosa')
    expect(professionalRoleLabel('tosador')).toBe('Tosador(a)')
    expect(professionalRoleLabel('Barbeiro(a)')).toBe('Barbeiro(a)')
  })

  it('ao salvar, nome de categoria antiga volta a ser o código (sem duplicar no filtro)', () => {
    expect(toStoredProductCategory('Rações')).toBe('racoes')
    expect(toStoredProductCategory('  racoes ')).toBe('racoes')
    expect(toStoredProductCategory('RACOES')).toBe('racoes')
    expect(toStoredServiceCategory('banho e tosa')).toBe('banho_tosa')
    expect(toStoredProfessionalRole('Atendente')).toBe('atendente')
  })

  it('texto novo é salvo limpo; vazio vira "outros"/"outro"', () => {
    expect(toStoredProductCategory('  Moda   praia ')).toBe('Moda praia')
    expect(toStoredProductCategory('')).toBe('outros')
    expect(toStoredServiceCategory('   ')).toBe('outro')
    expect(toStoredProductCategory('x'.repeat(60))).toHaveLength(40)
  })

  it('junta sugestões com as categorias já usadas, sem repetir', () => {
    const out = mergeOptions(['Rações', 'Petiscos'], ['racoes', 'Brinquedos'], productCategoryLabel)
    expect(out).toEqual(['Rações', 'Brinquedos', 'Petiscos'])
  })
})
