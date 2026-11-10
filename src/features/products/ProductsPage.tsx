import * as React from 'react'
import { EllipsisVertical, Package, Pencil, Plus, Power, Search, Trash2 } from 'lucide-react'
import { Badge, Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { useConfirm } from '@/components/ui/dialog'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/menu'
import { DataTable, EmptyState, ErrorState, PageHeader, TableSkeleton } from '@/components/ui/states'
import { ProductDialog } from '@/components/shared/ProductDialog'
import { useDeleteProduct, useProducts, useSaveProduct } from './api'
import { useOrg } from '@/features/org/OrgProvider'
import { CATEGORY, UNIT } from '@/domain/labels'
import { formatCurrency, formatNumber } from '@/lib/format'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import type { Product, ProductCategory } from '@/types/models'

export function ProductsPage() {
  useDocumentTitle('Produtos')
  const { org, isAdmin } = useOrg()
  const confirm = useConfirm()
  const q = useProducts({ includeInactive: true })
  const del = useDeleteProduct()
  const save = useSaveProduct()
  const [dialog, setDialog] = React.useState<{ open: boolean; product: Product | null }>({ open: false, product: null })
  const [search, setSearch] = React.useState('')
  const [category, setCategory] = React.useState<ProductCategory | ''>('')
  const [status, setStatus] = React.useState<'active' | 'inactive' | 'all'>('active')

  const rows = (q.data ?? []).filter((p) => {
    if (status === 'active' && !p.active) return false
    if (status === 'inactive' && p.active) return false
    if (category && p.category !== category) return false
    const s = search.trim().toLowerCase()
    return !s || p.name.toLowerCase().includes(s) || p.brand?.toLowerCase().includes(s) || p.sku?.toLowerCase().includes(s)
  })

  const toggleActive = (p: Product) =>
    save.mutate({
      id: p.id,
      values: {
        name: p.name, category: p.category, brand: p.brand ?? '', sku: p.sku ?? '', price: Number(p.price), cost: p.cost == null ? null : Number(p.cost),
        size_value: p.size_value == null ? null : Number(p.size_value), unit: p.unit, description: p.description ?? '', avg_duration_days: p.avg_duration_days, active: !p.active,
      },
      successMessage: p.active
        ? `${p.name} desativado. Ele não aparece mais no registro de compras e fica no filtro "Inativos".`
        : `${p.name} ativado novamente.`,
    })

  const remove = async (p: Product) => {
    if (await confirm({ title: `Excluir ${p.name}?`, description: 'Produtos com compras registradas não podem ser excluídos — desative-os para preservar o histórico.', confirmLabel: 'Excluir', danger: true }))
      del.mutate(p.id)
  }

  const actions = (p: Product) => (
    <Menu>
      <MenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Ações do produto"><EllipsisVertical /></Button>
      </MenuTrigger>
      <MenuContent>
        <MenuItem onSelect={() => setDialog({ open: true, product: p })}><Pencil /> Editar</MenuItem>
        <MenuItem onSelect={() => toggleActive(p)}><Power /> {p.active ? 'Desativar' : 'Ativar'}</MenuItem>
        {isAdmin && (
          <>
            <MenuSeparator />
            <MenuItem danger onSelect={() => remove(p)}><Trash2 /> Excluir</MenuItem>
          </>
        )}
      </MenuContent>
    </Menu>
  )

  const duration = (p: Product) => (p.avg_duration_days ? `${p.avg_duration_days} dias` : `${org.default_duration_days} dias (padrão)`)

  return (
    <>
      <PageHeader
        title="Produtos"
        description="Catálogo usado nas compras. A duração média alimenta a previsão de recompra."
        actions={<Button onClick={() => setDialog({ open: true, product: null })}><Plus /> Novo produto</Button>}
      />
      <Card>
        <div className="flex flex-col gap-3 border-b border-border p-4 md:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
            <Input placeholder="Buscar por nome, marca ou SKU" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Buscar produtos" />
          </div>
          <div className="grid grid-cols-2 gap-3 md:w-96">
            <Select value={category} onChange={(e) => setCategory(e.target.value as ProductCategory | '')} aria-label="Categoria">
              <option value="">Todas as categorias</option>
              {Object.entries(CATEGORY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
            <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label="Status">
              <option value="active">Ativos</option>
              <option value="inactive">Inativos</option>
              <option value="all">Todos</option>
            </Select>
          </div>
        </div>
        {q.isLoading ? (
          <TableSkeleton />
        ) : q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data?.length ? (
          <EmptyState
            icon={Package}
            title="Nenhum produto cadastrado"
            description="Cadastre rações, areia, medicamentos e outros itens com a duração média de cada um para prever recompras."
            action={<Button onClick={() => setDialog({ open: true, product: null })}><Plus /> Cadastrar produto</Button>}
          />
        ) : !rows.length ? (
          <EmptyState icon={Search} title="Nenhum produto encontrado" description="Ajuste a busca ou os filtros." />
        ) : (
          <DataTable
            head={<><th>Produto</th><th>Categoria</th><th>Preço</th><th>Tamanho</th><th>Duração média</th><th>Status</th><th className="w-12" /></>}
            mobile={rows.map((p) => (
              <div key={p.id} className="flex items-start gap-3 px-4 py-3.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{p.name}</div>
                  <div className="mt-0.5 text-xs text-muted">{CATEGORY[p.category]} · {formatCurrency(p.price)} · {duration(p)}</div>
                  {!p.active && <Badge tone="muted" className="mt-2">Inativo</Badge>}
                </div>
                {actions(p)}
              </div>
            ))}
          >
            {rows.map((p) => (
              <tr key={p.id}>
                <td>
                  <div className="font-medium">{p.name}</div>
                  <div className="text-xs text-muted">{[p.brand, p.sku].filter(Boolean).join(' · ') || '—'}</div>
                </td>
                <td className="text-muted">{CATEGORY[p.category]}</td>
                <td className="tabular">{formatCurrency(p.price)}</td>
                <td className="tabular text-muted">{p.size_value ? `${formatNumber(p.size_value)} ${UNIT[p.unit]}` : '—'}</td>
                <td className="tabular">{duration(p)}</td>
                <td>{p.active ? <Badge tone="brand" dot>Ativo</Badge> : <Badge tone="muted">Inativo</Badge>}</td>
                <td>{actions(p)}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>
      <ProductDialog open={dialog.open} product={dialog.product} onOpenChange={(o) => setDialog((s) => ({ ...s, open: o }))} />
    </>
  )
}
