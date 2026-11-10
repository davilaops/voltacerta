import * as React from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/input'
import { customerSchema, petSchema, type CustomerInput, type PetInput } from '@/features/customers/schemas'
import { useSaveCustomer } from '@/features/customers/api'
import { useOrg } from '@/features/org/OrgProvider'
import { SPECIES } from '@/domain/labels'
import type { Customer, Pet } from '@/types/models'

const emptyCustomer: CustomerInput = { full_name: '', phone: '', email: '', notes: '', marketing_consent: false, do_not_contact: false }

export function CustomerDialog({
  open,
  onOpenChange,
  customer,
  onSaved,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  customer?: Customer | null
  onSaved?: (c: Customer) => void
}) {
  const save = useSaveCustomer()
  const { canWrite } = useOrg()
  const form = useForm<CustomerInput>({ resolver: zodResolver(customerSchema), defaultValues: emptyCustomer })
  // Pet opcional no cadastro inicial: validado pelo banco (nome obrigatório só se preenchido)
  const petForm = useForm<PetInput>({ defaultValues: { name: '', species: 'cao' } })

  React.useEffect(() => {
    if (!open) return
    form.reset(
      customer
        ? {
            full_name: customer.full_name,
            phone: customer.phone ?? '',
            email: customer.email ?? '',
            notes: customer.notes ?? '',
            marketing_consent: customer.marketing_consent,
            do_not_contact: customer.do_not_contact,
          }
        : emptyCustomer,
    )
    petForm.reset({ name: '', species: 'cao', breed: '', birth_date: '', notes: '' })
  }, [open, customer, form, petForm])

  const onSubmit = form.handleSubmit(async (values) => {
    const pet = customer ? null : petForm.getValues()
    const saved = await save.mutateAsync({ id: customer?.id, values, pet: pet?.name ? pet : null }).catch(() => null)
    if (saved) {
      onOpenChange(false)
      onSaved?.(saved)
    }
  })

  const e = form.formState.errors
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={customer ? 'Editar cliente' : 'Novo cliente'}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={onSubmit} loading={save.isPending} disabled={!canWrite}>
            {customer ? 'Salvar alterações' : 'Cadastrar cliente'}
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="Nome completo" htmlFor="full_name" error={e.full_name?.message}>
          <Input id="full_name" autoFocus aria-invalid={!!e.full_name} {...form.register('full_name')} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Telefone (WhatsApp)" htmlFor="phone" error={e.phone?.message} hint="Usado para evitar cadastros duplicados.">
            <Input id="phone" type="tel" inputMode="tel" placeholder="(11) 98888-7777" aria-invalid={!!e.phone} {...form.register('phone')} />
          </Field>
          <Field label="E-mail" htmlFor="email" optional error={e.email?.message}>
            <Input id="email" type="email" aria-invalid={!!e.email} {...form.register('email')} />
          </Field>
        </div>

        {!customer && (
          <fieldset className="space-y-3 rounded-md border border-border p-3">
            <legend className="px-1 text-[13px] font-medium">Pet <span className="font-normal text-subtle">(opcional — você pode adicionar outros depois)</span></legend>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Nome do pet" htmlFor="pet_name">
                <Input id="pet_name" {...petForm.register('name')} />
              </Field>
              <Field label="Espécie" htmlFor="pet_species">
                <Select id="pet_species" {...petForm.register('species')}>
                  {Object.entries(SPECIES).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Raça" htmlFor="pet_breed" optional>
                <Input id="pet_breed" {...petForm.register('breed')} />
              </Field>
            </div>
          </fieldset>
        )}

        <Field label="Observações" htmlFor="notes" optional error={e.notes?.message}>
          <Textarea id="notes" rows={2} {...form.register('notes')} />
        </Field>

        <div className="space-y-3 rounded-md border border-border bg-surface-2/40 p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-subtle">Comunicação (LGPD)</p>
          <Checkbox
            label="Cliente autorizou receber mensagens de reposição"
            description="Registre somente com consentimento do cliente."
            {...form.register('marketing_consent')}
          />
          <Checkbox
            label="Cliente pediu para não ser contatado"
            description="Bloqueia contatos comerciais para este cliente."
            {...form.register('do_not_contact')}
          />
        </div>
      </form>
    </Dialog>
  )
}

export function PetDialog({
  open,
  onOpenChange,
  pet,
  onSubmit,
  loading,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  pet?: Pet | null
  onSubmit: (v: PetInput) => void
  loading?: boolean
}) {
  const form = useForm<PetInput>({ resolver: zodResolver(petSchema), defaultValues: { name: '', species: 'cao' } })
  React.useEffect(() => {
    if (open)
      form.reset(
        pet
          ? { name: pet.name, species: pet.species, breed: pet.breed ?? '', birth_date: pet.birth_date ?? '', notes: pet.notes ?? '' }
          : { name: '', species: 'cao', breed: '', birth_date: '', notes: '' },
      )
  }, [open, pet, form])
  const submit = form.handleSubmit(onSubmit)
  const e = form.formState.errors
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={pet ? 'Editar pet' : 'Adicionar pet'}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} loading={loading}>Salvar</Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Nome" htmlFor="pname" error={e.name?.message}>
          <Input id="pname" autoFocus {...form.register('name')} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Espécie" htmlFor="pspecies">
            <Select id="pspecies" {...form.register('species')}>
              {Object.entries(SPECIES).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </Select>
          </Field>
          <Field label="Raça" htmlFor="pbreed" optional>
            <Input id="pbreed" {...form.register('breed')} />
          </Field>
        </div>
        <Field label="Data de nascimento" htmlFor="pbirth" optional error={e.birth_date?.message}>
          <Input id="pbirth" type="date" {...form.register('birth_date')} />
        </Field>
        <Field label="Observações" htmlFor="pnotes" optional>
          <Textarea id="pnotes" rows={2} {...form.register('notes')} />
        </Field>
      </form>
    </Dialog>
  )
}
