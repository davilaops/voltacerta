import * as React from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/input'
import { productSchema, useSaveProduct, type ProductFormValues, type ProductInput } from '@/features/products/api'
import { useOrg } from '@/features/org/OrgProvider'
import { CATEGORY, UNIT } from '@/domain/labels'
import type { Product } from '@/types/models'

const SUGGESTED_DAYS: Record<string, number> = { racoes: 30, petiscos: 15, areia: 20, medicamentos: 30, higiene: 45 }

const empty: ProductFormValues = {
  name: '', category: 'racoes', brand: '', sku: '', price: '', cost: '', size_value: '', unit: 'kg', description: '', avg_duration_days: '30', active: true,
}

export function ProductDialog({ open, onOpenChange, product, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; product?: Product | null; onSaved?: (p: Product) => void }) {
  const save = useSaveProduct()
  const { org, canWrite } = useOrg()
  const form = useForm<ProductFormValues, unknown, ProductInput>({ resolver: zodResolver(productSchema), defaultValues: empty })

  React.useEffect(() => {
    if (!open) return
    form.reset(
      product
        ? {
            name: product.name,
            category: product.category,
            brand: product.brand ?? '',
            sku: product.sku ?? '',
            price: String(product.price).replace('.', ','),
            cost: product.cost == null ? '' : String(product.cost).replace('.', ','),
            size_value: product.size_value == null ? '' : String(product.size_value).replace('.', ','),
            unit: product.unit,
            description: product.description ?? '',
            avg_duration_days: product.avg_duration_days == null ? '' : String(product.avg_duration_days),
            active: product.active,
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
  const category = form.watch('category')

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
          <Input id="name" autoFocus placeholder="Ex.: Ração Premium Adulto 15kg" aria-invalid={!!e.name} {...form.register('name')} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Categoria" htmlFor="category">
            <Select
              id="category"
              {...form.register('category', {
                onChange: (ev) => {
                  if (!product && SUGGESTED_DAYS[ev.target.value]) form.setValue('avg_duration_days', String(SUGGESTED_DAYS[ev.target.value]))
                },
              })}
            >
              {Object.entries(CATEGORY).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </Select>
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
          hint={`Quanto tempo 1 unidade costuma durar. Em branco usa o padrão do estabelecimento (${org.default_duration_days} dias).${SUGGESTED_DAYS[category] ? ` Sugestão para ${CATEGORY[category as keyof typeof CATEGORY].toLowerCase()}: ${SUGGESTED_DAYS[category]} dias.` : ''}`}
        >
          <Input id="avg_duration_days" inputMode="numeric" aria-invalid={!!e.avg_duration_days} {...form.register('avg_duration_days')} />
        </Field>
        <Field label="Descrição" htmlFor="description" optional>
          <Textarea id="description" rows={2} {...form.register('description')} />
        </Field>
        <Checkbox label="Produto ativo" description="Produtos inativos não aparecem no registro de compras." {...form.register('active')} />
      </form>
    </Dialog>
  )
}
