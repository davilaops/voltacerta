import * as React from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/input'
import { productSchema, useSaveProduct, type ProductFormValues, type ProductInput } from '@/features/products/api'
import { useOrg } from '@/features/org/OrgProvider'
import { UNIT } from '@/domain/labels'
import { SUGGESTED_DAYS, mergeOptions, productCategoryLabel, suggestionsFor, toStoredProductCategory } from '@/domain/business'
import { CategoryInput } from '@/components/shared/CategoryInput'
import { useProducts } from '@/features/products/api'
import type { Product } from '@/types/models'

const empty: ProductFormValues = {
  name: '', category: '', brand: '', sku: '', price: '', cost: '', size_value: '', unit: 'un', description: '', avg_duration_days: '30', active: true,
  track_stock: false, min_stock: '', supplier: '', lead_time_days: '7', catalog_visible: false, ncm: '', cfop: '5102', fiscal_origin: '0',
}

export function ProductDialog({ open, onOpenChange, product, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; product?: Product | null; onSaved?: (p: Product) => void }) {
  const save = useSaveProduct()
  const { org, canWrite } = useOrg()
  const form = useForm<ProductFormValues, unknown, ProductInput>({ resolver: zodResolver(productSchema), defaultValues: empty })
  const products = useProducts({ includeInactive: true })
  const sugg = suggestionsFor(org.business_type)
  const options = React.useMemo(
    () => mergeOptions(sugg.products, [...new Set((products.data ?? []).map((p) => p.category))].filter((c) => c !== 'outros'), productCategoryLabel),
    [sugg.products, products.data],
  )

  React.useEffect(() => {
    if (!open) return
    form.reset(
      product
        ? {
            name: product.name,
            category: product.category === 'outros' ? '' : productCategoryLabel(product.category),
            brand: product.brand ?? '',
            sku: product.sku ?? '',
            price: String(product.price).replace('.', ','),
            cost: product.cost == null ? '' : String(product.cost).replace('.', ','),
            size_value: product.size_value == null ? '' : String(product.size_value).replace('.', ','),
            unit: product.unit,
            description: product.description ?? '',
            avg_duration_days: product.avg_duration_days == null ? '' : String(product.avg_duration_days),
            active: product.active,
            track_stock: product.track_stock,
            min_stock: product.min_stock == null ? '' : String(product.min_stock).replace('.', ','),
            supplier: product.supplier ?? '',
            lead_time_days: String(product.lead_time_days ?? 7),
            catalog_visible: product.catalog_visible,
            ncm: product.ncm ?? '',
            cfop: product.cfop ?? '5102',
            fiscal_origin: String(product.fiscal_origin ?? 0),
          }
        : empty,
    )
  }, [open, product, form])

  const onSubmit = form.handleSubmit(async (values) => {
    const saved = await save.mutateAsync({ id: product?.id, values }).catch(() => null)
    if (saved) {
      onOpenChange(false)
      onSaved?.(saved)
    }
  })

  const e = form.formState.errors
  const category = toStoredProductCategory(form.watch('category') ?? '')

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={product ? 'Editar produto' : 'Novo produto'}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={onSubmit} loading={save.isPending} disabled={!canWrite}>
            {product ? 'Salvar alterações' : 'Cadastrar produto'}
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="Nome" htmlFor="name" error={e.name?.message}>
          <Input id="name" autoFocus placeholder={sugg.productExample} aria-invalid={!!e.name} {...form.register('name')} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Categoria" htmlFor="category" optional error={e.category?.message}>
            <CategoryInput
              id="category"
              options={options}
              {...form.register('category', {
                onChange: (ev) => {
                  const days = SUGGESTED_DAYS[toStoredProductCategory(ev.target.value)]
                  if (!product && days) form.setValue('avg_duration_days', String(days))
                },
              })}
            />
          </Field>
          <Field label="Marca" htmlFor="brand" optional>
            <Input id="brand" {...form.register('brand')} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Field label="Preço de venda (R$)" htmlFor="price" error={e.price?.message}>
            <Input id="price" inputMode="decimal" placeholder="0,00" aria-invalid={!!e.price} {...form.register('price')} />
          </Field>
          <Field label="Custo (R$)" htmlFor="cost" optional error={e.cost?.message}>
            <Input id="cost" inputMode="decimal" placeholder="0,00" {...form.register('cost')} />
          </Field>
          <Field label="Código / SKU" htmlFor="sku" optional className="col-span-2 sm:col-span-1">
            <Input id="sku" {...form.register('sku')} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Peso / quantidade" htmlFor="size_value" optional error={e.size_value?.message}>
            <Input id="size_value" inputMode="decimal" placeholder="15" {...form.register('size_value')} />
          </Field>
          <Field label="Unidade" htmlFor="unit">
            <Select id="unit" {...form.register('unit')}>
              {Object.entries(UNIT).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </Select>
          </Field>
        </div>
        <Field
          label="Duração média estimada (dias)"
          htmlFor="avg_duration_days"
          error={e.avg_duration_days?.message}
          hint={`Quanto tempo 1 unidade costuma durar. Em branco usa o padrão do estabelecimento (${org.default_duration_days} dias).${SUGGESTED_DAYS[category] ? ` Sugestão para ${productCategoryLabel(category).toLowerCase()}: ${SUGGESTED_DAYS[category]} dias.` : ''}`}
        >
          <Input id="avg_duration_days" inputMode="numeric" aria-invalid={!!e.avg_duration_days} {...form.register('avg_duration_days')} />
        </Field>
        <Field label="Descrição" htmlFor="description" optional>
          <Textarea id="description" rows={2} {...form.register('description')} />
        </Field>
        <details className="group rounded-md border border-border" open={form.watch('track_stock')}>
          <summary className="cursor-pointer list-none px-3 py-2.5 text-[13px] font-medium">Estoque e fornecedor</summary>
          <div className="space-y-4 border-t border-border p-3">
            <Checkbox label="Controlar estoque deste produto" description="As vendas baixam o saldo automaticamente. O saldo é ajustado na tela Estoque." {...form.register('track_stock')} />
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Field label="Estoque mínimo" htmlFor="min_stock" optional error={e.min_stock?.message}>
                <Input id="min_stock" inputMode="decimal" {...form.register('min_stock')} />
              </Field>
              <Field label="Prazo de entrega (dias)" htmlFor="lead_time_days" error={e.lead_time_days?.message}>
                <Input id="lead_time_days" inputMode="numeric" {...form.register('lead_time_days')} />
              </Field>
              <Field label="Fornecedor" htmlFor="supplier" optional className="col-span-2 sm:col-span-1">
                <Input id="supplier" {...form.register('supplier')} />
              </Field>
            </div>
          </div>
        </details>
        <details className="group rounded-md border border-border">
          <summary className="cursor-pointer list-none px-3 py-2.5 text-[13px] font-medium">Dados fiscais (para nota fiscal)</summary>
          <div className="grid grid-cols-3 gap-4 border-t border-border p-3">
            <Field label="NCM" htmlFor="ncm" optional error={e.ncm?.message} hint="8 dígitos">
              <Input id="ncm" inputMode="numeric" maxLength={8} {...form.register('ncm')} />
            </Field>
            <Field label="CFOP" htmlFor="cfop" error={e.cfop?.message} hint="Venda: 5102">
              <Input id="cfop" inputMode="numeric" maxLength={4} {...form.register('cfop')} />
            </Field>
            <Field label="Origem" htmlFor="fiscal_origin" hint="0 = nacional">
              <Select id="fiscal_origin" {...form.register('fiscal_origin')}>
                {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((o) => <option key={o} value={o}>{o}</option>)}
              </Select>
            </Field>
          </div>
        </details>
        <Checkbox label="Mostrar no catálogo online" description="Aparece na página pública da loja, se o catálogo estiver publicado." {...form.register('catalog_visible')} />
        <Checkbox label="Produto ativo" description="Produtos inativos não aparecem no registro de compras." {...form.register('active')} />
      </form>
    </Dialog>
  )
}
