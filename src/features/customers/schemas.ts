import { z } from 'zod'
import { normalizePhone } from '@/lib/phone'

const optionalText = (max: number) => z.string().trim().max(max, `Máximo de ${max} caracteres`).optional().or(z.literal(''))

export const customerSchema = z.object({
  full_name: z.string().trim().min(2, 'Informe o nome completo').max(120),
  phone: z
    .string()
    .trim()
    .optional()
    .or(z.literal(''))
    .refine((v) => !v || normalizePhone(v) !== null, 'Telefone inválido. Use DDD + número.'),
  email: z.string().trim().email('E-mail inválido').optional().or(z.literal('')),
  notes: optionalText(2000),
  marketing_consent: z.boolean(),
  do_not_contact: z.boolean(),
})
export type CustomerInput = z.infer<typeof customerSchema>

export const SPECIES_VALUES = ['cao', 'gato', 'ave', 'roedor', 'peixe', 'reptil', 'outro'] as const

export const petSchema = z.object({
  name: z.string().trim().min(1, 'Informe o nome do pet').max(80),
  species: z.enum(SPECIES_VALUES),
  breed: optionalText(80),
  birth_date: z
    .string()
    .optional()
    .or(z.literal(''))
    .refine((v) => !v || (v > '1980-01-01' && v <= new Date().toISOString().slice(0, 10)), 'Data inválida'),
  notes: optionalText(1000),
})
export type PetInput = z.infer<typeof petSchema>
