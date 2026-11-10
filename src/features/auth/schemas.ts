import { z } from 'zod'

export const loginSchema = z.object({
  email: z.string().trim().email('Informe um e-mail válido'),
  password: z.string().min(1, 'Informe sua senha'),
})

export const passwordSchema = z
  .string()
  .min(8, 'Mínimo de 8 caracteres')
  .max(72, 'Máximo de 72 caracteres')
  .regex(/[A-Za-z]/, 'Inclua ao menos uma letra')
  .regex(/\d/, 'Inclua ao menos um número')

export const signupSchema = z.object({
  fullName: z.string().trim().min(2, 'Informe seu nome').max(120),
  email: z.string().trim().email('Informe um e-mail válido'),
  password: passwordSchema,
  acceptTerms: z.boolean().refine((v) => v, 'É necessário aceitar os termos para continuar'),
})

export const forgotSchema = z.object({ email: z.string().trim().email('Informe um e-mail válido') })

export const resetSchema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((d) => d.password === d.confirm, { message: 'As senhas não conferem', path: ['confirm'] })
