import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { z } from 'zod'
import { supabase, unwrap } from '@/lib/supabase'
import { errorMessage } from '@/lib/errors'
import { useOrg } from '@/features/org/OrgProvider'
import type { Product } from '@/types/models'

export const CATEGORY_VALUES = ['racoes', 'petiscos', 'areia', 'medicamentos', 'higiene', 'acessorios', 'outros'] as const
export const UNIT_VALUES = ['kg', 'g', 'l', 'ml', 'un', 'cx', 'pct'] as const

const money = z
  .union([z.string(), z.number()])
  .transform((v) => (typeof v === 'number' ? v : Number(String(v).replace(/\./g, '').replace(',', '.'))))

export const productSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome').max(120),
  category: z.enum(CATEGORY_VALUES),
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
    mutationFn: async ({ id, values }: { id?: string; values: ProductInput }) => {
      const row = { ...values, brand: values.brand || null, sku: values.sku || null, description: values.description || null }
      if (id) return unwrap(await supabase.from('products').update(row).eq('id', id).select().single()) as Product
      return unwrap(await supabase.from('products').insert({ ...row, organization_id: org.id }).select().single()) as Product
    },
    onSuccess: (_, v) => {
      toast.success(v.id ? 'Produto atualizado.' : 'Produto cadastrado.')
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
