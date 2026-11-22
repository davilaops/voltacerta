import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { z } from 'zod'
import { supabase, unwrap } from '@/lib/supabase'
import { errorMessage } from '@/lib/errors'
import { useOrg } from '@/features/org/OrgProvider'
import { toStoredProductCategory } from '@/domain/business'
import type { Product } from '@/types/models'

export const UNIT_VALUES = ['kg', 'g', 'l', 'ml', 'un', 'cx', 'pct'] as const

const money = z
  .union([z.string(), z.number()])
  .transform((v) => (typeof v === 'number' ? v : Number(String(v).replace(/\./g, '').replace(',', '.'))))

export const productSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome').max(120),
  // Texto livre; o nome de uma categoria antiga volta a ser o código antigo
  category: z.string().max(40, 'Use até 40 caracteres').transform(toStoredProductCategory),
  brand: z.string().trim().max(80).optional().or(z.literal('')),
  sku: z.string().trim().max(60).optional().or(z.literal('')),
  price: money.pipe(z.number({ message: 'Valor inválido' }).min(0, 'Valor inválido').max(1_000_000)),
  cost: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => (v === '' || v == null ? null : Number(String(v).replace(/\./g, '').replace(',', '.'))))
    .pipe(z.number().min(0, 'Valor inválido').nullable()),
  size_value: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => (v === '' || v == null ? null : Number(String(v).replace(',', '.'))))
    .pipe(z.number().positive('Valor inválido').nullable()),
  unit: z.enum(UNIT_VALUES),
  description: z.string().trim().max(1000).optional().or(z.literal('')),
  avg_duration_days: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => (v === '' || v == null ? null : Number(v)))
    .pipe(z.number().int('Use dias inteiros').min(1, 'Mínimo 1 dia').max(365, 'Máximo 365 dias').nullable()),
  active: z.boolean(),
  // Estoque, catálogo e dados fiscais (opcionais)
  track_stock: z.boolean().default(false),
  min_stock: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => (v === '' || v == null ? null : Number(String(v).replace(',', '.'))))
    .pipe(z.number().min(0, 'Valor inválido').nullable()),
  supplier: z.string().trim().max(120).optional().or(z.literal('')),
  lead_time_days: z.coerce.number<string | number>().int('Use dias inteiros').min(0, 'Mínimo 0').max(120, 'Máximo 120').default(7),
  catalog_visible: z.boolean().default(false),
  ncm: z.string().trim().regex(/^(\d{8})?$/, 'O NCM tem 8 dígitos').optional().or(z.literal('')),
  cfop: z.string().trim().regex(/^\d{4}$/, 'O CFOP tem 4 dígitos').default('5102'),
  fiscal_origin: z.coerce.number<string | number>().int().min(0).max(8).default(0),
})
export type ProductFormValues = z.input<typeof productSchema>
export type ProductInput = z.output<typeof productSchema>

export function useProducts(opts: { includeInactive?: boolean } = {}) {
  const { org } = useOrg()
  return useQuery({
    queryKey: ['products', org.id, opts.includeInactive ?? false],
    queryFn: async () => {
      let q = supabase.from('products').select('*').eq('organization_id', org.id).order('name')
      if (!opts.includeInactive) q = q.eq('active', true)
      return unwrap(await q) as Product[]
    },
  })
}

export function useSaveProduct() {
  const qc = useQueryClient()
  const { org } = useOrg()
  return useMutation({
    mutationFn: async ({ id, values }: { id?: string; values: ProductInput; successMessage?: string }) => {
      const row = { ...values, brand: values.brand || null, sku: values.sku || null, description: values.description || null, supplier: values.supplier || null, ncm: values.ncm || null }
      if (id) return unwrap(await supabase.from('products').update(row).eq('id', id).select().single()) as Product
      return unwrap(await supabase.from('products').insert({ ...row, organization_id: org.id }).select().single()) as Product
    },
    onSuccess: (_, v) => {
      toast.success(v.successMessage ?? (v.id ? 'Produto atualizado.' : 'Produto cadastrado.'))
      qc.invalidateQueries({ queryKey: ['products'] })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
}

export function useDeleteProduct() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const res = unwrap(await supabase.from('products').delete().eq('id', id).select('id')) as unknown[]
      if (!res.length) throw new Error('FORBIDDEN')
    },
    onSuccess: () => {
      toast.success('Produto excluído.')
      qc.invalidateQueries({ queryKey: ['products'] })
    },
    onError: (e) => {
      const code = (e as { code?: string }).code
      toast.error(code === '23503' ? 'Este produto possui compras registradas. Desative-o em vez de excluir.' : errorMessage(e))
    },
  })
}
