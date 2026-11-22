/**
 * Ramos de estabelecimento e categorias livres.
 *
 * Categorias de produto e de serviço e a função do profissional são texto livre
 * (migration 0018). Os códigos antigos (racoes, banho, tosador…) continuam no banco
 * e são exibidos pelo nome; ao salvar, um texto igual a um desses nomes volta a ser
 * o código antigo, para não duplicar a mesma categoria nos filtros.
 */

export type BusinessGroup = 'pet' | 'beleza' | 'saude' | 'alimentacao' | 'moda' | 'auto' | 'casa' | 'servicos' | 'geral'

export const BUSINESS_TYPES: { value: string; label: string; group: BusinessGroup }[] = [
  { value: 'loja', label: 'Loja / comércio', group: 'geral' },
  { value: 'mercado', label: 'Mercado ou conveniência', group: 'alimentacao' },
  { value: 'restaurante', label: 'Restaurante, lanchonete ou padaria', group: 'alimentacao' },
  { value: 'salao_beleza', label: 'Salão de beleza', group: 'beleza' },
  { value: 'barbearia', label: 'Barbearia', group: 'beleza' },
  { value: 'estetica', label: 'Estética, unhas ou spa', group: 'beleza' },
  { value: 'clinica', label: 'Clínica ou consultório', group: 'saude' },
  { value: 'farmacia', label: 'Farmácia', group: 'saude' },
  { value: 'otica', label: 'Ótica', group: 'saude' },
  { value: 'academia', label: 'Academia ou estúdio', group: 'servicos' },
  { value: 'loja_roupas', label: 'Roupas, calçados ou acessórios', group: 'moda' },
  { value: 'oficina', label: 'Oficina ou autopeças', group: 'auto' },
  { value: 'materiais', label: 'Material de construção', group: 'casa' },
  { value: 'assistencia', label: 'Assistência técnica', group: 'servicos' },
  { value: 'servicos', label: 'Prestação de serviços', group: 'servicos' },
  { value: 'pet_shop', label: 'Pet shop', group: 'pet' },
  { value: 'loja_racao', label: 'Loja de rações', group: 'pet' },
  { value: 'veterinario', label: 'Clínica veterinária', group: 'pet' },
  { value: 'delivery', label: 'Pet shop com delivery', group: 'pet' },
  { value: 'rede', label: 'Rede de lojas', group: 'geral' },
  { value: 'outro', label: 'Outro', group: 'geral' },
]

const TYPE_BY_VALUE = new Map(BUSINESS_TYPES.map((t) => [t.value, t]))

export function businessTypeLabel(type: string | null | undefined): string | null {
  if (!type) return null
  return TYPE_BY_VALUE.get(type)?.label ?? type
}

export function businessGroup(type: string | null | undefined): BusinessGroup {
  return (type && TYPE_BY_VALUE.get(type)?.group) || 'geral'
}

interface Suggestions {
  products: string[]
  services: string[]
  roles: string[]
  productExample: string
  serviceExample: string
}

const GENERIC: Suggestions = {
  products: ['Produtos', 'Acessórios', 'Consumo', 'Kits', 'Promoções'],
  services: ['Atendimento', 'Instalação', 'Manutenção', 'Consultoria', 'Entrega'],
  roles: ['Atendente', 'Vendedor(a)', 'Técnico(a)', 'Gerente', 'Entregador(a)'],
  productExample: 'Ex.: Garrafa térmica 1L',
  serviceExample: 'Ex.: Atendimento padrão',
}

export const SUGGESTIONS: Record<BusinessGroup, Suggestions> = {
  pet: {
    products: ['Rações', 'Petiscos', 'Areia para gatos', 'Medicamentos', 'Higiene', 'Acessórios'],
    services: ['Banho', 'Tosa', 'Banho e tosa', 'Hidratação', 'Corte de unhas', 'Consulta', 'Vacina', 'Leva e traz'],
    roles: ['Banhista', 'Tosador(a)', 'Banhista e tosador(a)', 'Veterinário(a)', 'Atendente', 'Motorista'],
    productExample: 'Ex.: Ração Premium Adulto 15kg',
    serviceExample: 'Ex.: Banho porte médio',
  },
  beleza: {
    products: ['Cabelo', 'Unhas', 'Maquiagem', 'Skincare', 'Perfumaria', 'Barba'],
    services: ['Corte', 'Escova', 'Coloração', 'Manicure', 'Pedicure', 'Barba', 'Sobrancelha', 'Depilação', 'Limpeza de pele'],
    roles: ['Cabeleireiro(a)', 'Barbeiro(a)', 'Manicure', 'Esteticista', 'Maquiador(a)', 'Recepcionista'],
    productExample: 'Ex.: Shampoo hidratante 300ml',
    serviceExample: 'Ex.: Corte masculino',
  },
  saude: {
    products: ['Medicamentos', 'Suplementos', 'Higiene', 'Dermocosméticos', 'Lentes', 'Armações'],
    services: ['Consulta', 'Retorno', 'Exame', 'Sessão', 'Avaliação', 'Procedimento'],
    roles: ['Médico(a)', 'Dentista', 'Fisioterapeuta', 'Psicólogo(a)', 'Nutricionista', 'Recepcionista'],
    productExample: 'Ex.: Vitamina D 2000UI',
    serviceExample: 'Ex.: Consulta inicial',
  },
  alimentacao: {
    products: ['Mercearia', 'Bebidas', 'Padaria', 'Hortifrúti', 'Frios', 'Limpeza', 'Lanches'],
    services: ['Entrega', 'Encomenda', 'Evento', 'Buffet'],
    roles: ['Atendente', 'Caixa', 'Cozinheiro(a)', 'Garçom/Garçonete', 'Entregador(a)'],
    productExample: 'Ex.: Café torrado 500g',
    serviceExample: 'Ex.: Entrega no bairro',
  },
  moda: {
    products: ['Roupas', 'Calçados', 'Acessórios', 'Bolsas', 'Infantil', 'Moda praia'],
    services: ['Ajuste / costura', 'Personalização', 'Entrega'],
    roles: ['Vendedor(a)', 'Costureira(o)', 'Caixa', 'Gerente'],
    productExample: 'Ex.: Camiseta básica M',
    serviceExample: 'Ex.: Barra de calça',
  },
  auto: {
    products: ['Peças', 'Óleos e fluidos', 'Pneus', 'Baterias', 'Acessórios'],
    services: ['Revisão', 'Troca de óleo', 'Alinhamento', 'Balanceamento', 'Lavagem', 'Diagnóstico'],
    roles: ['Mecânico(a)', 'Eletricista', 'Lavador(a)', 'Atendente'],
    productExample: 'Ex.: Óleo 5W30 1L',
    serviceExample: 'Ex.: Troca de óleo',
  },
  casa: {
    products: ['Básico', 'Hidráulica', 'Elétrica', 'Tintas', 'Ferramentas', 'Acabamento'],
    services: ['Entrega', 'Corte sob medida', 'Instalação', 'Mistura de tinta'],
    roles: ['Vendedor(a)', 'Entregador(a)', 'Caixa', 'Montador(a)'],
    productExample: 'Ex.: Cimento 50kg',
    serviceExample: 'Ex.: Entrega até 10 km',
  },
  servicos: {
    products: ['Peças', 'Acessórios', 'Suplementos', 'Planos', 'Consumo'],
    services: ['Atendimento', 'Aula', 'Avaliação', 'Manutenção', 'Instalação', 'Visita técnica'],
    roles: ['Técnico(a)', 'Instrutor(a)', 'Personal', 'Atendente', 'Recepcionista'],
    productExample: 'Ex.: Película de vidro',
    serviceExample: 'Ex.: Troca de tela',
  },
  geral: GENERIC,
}

export function suggestionsFor(type: string | null | undefined): Suggestions {
  return SUGGESTIONS[businessGroup(type)]
}

// ---------------------------------------------------------------------
// Códigos antigos (fixos de pet shop), ainda presentes no banco
// ---------------------------------------------------------------------
export const LEGACY_PRODUCT_CATEGORY: Record<string, string> = {
  racoes: 'Rações',
  petiscos: 'Petiscos',
  areia: 'Areia para gatos',
  medicamentos: 'Medicamentos',
  higiene: 'Higiene',
  acessorios: 'Acessórios',
  outros: 'Outros',
}

export const LEGACY_SERVICE_CATEGORY: Record<string, string> = {
  banho: 'Banho',
  tosa: 'Tosa',
  banho_tosa: 'Banho e tosa',
  hidratacao: 'Hidratação',
  unhas: 'Corte de unhas',
  consulta: 'Consulta',
  vacina: 'Vacina',
  transporte: 'Leva e traz',
  outro: 'Outro',
}

export const LEGACY_PROFESSIONAL_ROLE: Record<string, string> = {
  banhista: 'Banhista',
  tosador: 'Tosador(a)',
  banhista_tosador: 'Banhista e tosador(a)',
  veterinario: 'Veterinário(a)',
  atendente: 'Atendente',
  motorista: 'Motorista',
  outro: 'Outro',
}

function label(map: Record<string, string>, value: string | null | undefined): string {
  if (!value) return map.outro ?? map.outros ?? ''
  return map[value] ?? value
}

export const productCategoryLabel = (v: string | null | undefined) => label(LEGACY_PRODUCT_CATEGORY, v)
export const serviceCategoryLabel = (v: string | null | undefined) => label(LEGACY_SERVICE_CATEGORY, v)
export const professionalRoleLabel = (v: string | null | undefined) => label(LEGACY_PROFESSIONAL_ROLE, v)

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()

/** Texto digitado -> valor salvo. Vazio vira o "outro(s)" antigo; nome de código antigo vira o código. */
export function toStoredCategory(text: string, legacy: Record<string, string>, empty: string): string {
  const t = text.trim().replace(/\s+/g, ' ').slice(0, 40)
  if (!t) return empty
  const hit = Object.entries(legacy).find(([k, v]) => fold(v) === fold(t) || k === t)
  return hit ? hit[0] : t
}

export const toStoredProductCategory = (t: string) => toStoredCategory(t, LEGACY_PRODUCT_CATEGORY, 'outros')
export const toStoredServiceCategory = (t: string) => toStoredCategory(t, LEGACY_SERVICE_CATEGORY, 'outro')
export const toStoredProfessionalRole = (t: string) => toStoredCategory(t, LEGACY_PROFESSIONAL_ROLE, 'outro')

/** Sugestões do ramo + categorias já usadas, sem repetir (comparando pelo nome exibido). */
export function mergeOptions(suggested: string[], used: string[], toLabel: (v: string) => string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const v of [...used.map(toLabel), ...suggested]) {
    const k = fold(v)
    if (!v || seen.has(k)) continue
    seen.add(k)
    out.push(v)
  }
  return out
}

/** Duração sugerida (dias) por categoria de produto, quando o ramo tem uma referência. */
export const SUGGESTED_DAYS: Record<string, number> = { racoes: 30, petiscos: 15, areia: 20, medicamentos: 30, higiene: 45 }
