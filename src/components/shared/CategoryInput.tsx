import * as React from 'react'
import { Input } from '@/components/ui/input'

/** Campo de texto livre com sugestões (datalist): o usuário escolhe uma ou digita outra. */
export const CategoryInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { options: string[] }>(
  ({ options, id, ...props }, ref) => {
    const listId = `${id ?? 'cat'}-options`
    return (
      <>
        <Input ref={ref} id={id} list={listId} maxLength={40} autoComplete="off" placeholder="Escolha ou digite" {...props} />
        <datalist id={listId}>
          {options.map((o) => <option key={o} value={o} />)}
        </datalist>
      </>
    )
  },
)
CategoryInput.displayName = 'CategoryInput'
