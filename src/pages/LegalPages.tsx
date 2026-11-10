import * as React from 'react'
import { Link } from 'react-router-dom'
import { Compass } from 'lucide-react'
import { Logo } from '@/components/brand/Logo'
import { Button } from '@/components/ui/button'
import { useDocumentTitle } from '@/lib/useDocumentTitle'

function LegalLayout({ title, children }: { title: string; children: React.ReactNode }) {
  useDocumentTitle(title)
  return (
    <div className="min-h-dvh bg-bg px-5 py-10">
      <div className="mx-auto max-w-2xl">
        <Link to="/"><Logo /></Link>
        <h1 className="mt-10 text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-xs text-subtle">Modelo inicial — revise com assessoria jurídica antes de publicar.</p>
        <div className="mt-8 space-y-5 text-sm leading-relaxed text-muted [&_h2]:mt-8 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-fg">{children}</div>
      </div>
    </div>
  )
}

export function PrivacyPage() {
  return (
    <LegalLayout title="Política de Privacidade">
      <p>O VoltaCerta trata dados pessoais conforme a Lei Geral de Proteção de Dados (Lei nº 13.709/2018).</p>
      <h2>Dados dos usuários</h2>
      <p>Coletamos nome, e-mail e dados do estabelecimento para criar e operar sua conta, autenticar o acesso e cobrar a assinatura.</p>
      <h2>Dados dos clientes do estabelecimento</h2>
      <p>O estabelecimento é o controlador dos dados de seus clientes (nome, telefone, e-mail opcional, pets e compras). O VoltaCerta atua como operador, tratando esses dados apenas para prever recompras e organizar contatos. Os dados de cada estabelecimento são isolados e nunca compartilhados com outros estabelecimentos.</p>
      <h2>Comunicação comercial</h2>
      <p>O sistema permite registrar consentimento e oposição ao contato. Contatos com clientes que se opuseram são bloqueados. Não realizamos disparos automáticos de mensagens.</p>
      <h2>Direitos dos titulares</h2>
      <p>É possível exportar e excluir os dados de um cliente a qualquer momento pelo painel. Proprietários podem solicitar a exclusão de todos os dados do estabelecimento em Configurações → Privacidade e dados.</p>
      <h2>Segurança</h2>
      <p>Aplicamos controle de acesso por organização no banco de dados, criptografia em trânsito e registro de auditoria das operações importantes.</p>
    </LegalLayout>
  )
}

export function TermsPage() {
  return (
    <LegalLayout title="Termos de Uso">
      <p>Ao criar uma conta você concorda com estes termos.</p>
      <h2>Serviço</h2>
      <p>O VoltaCerta é uma ferramenta de apoio à recompra. As previsões são estimativas baseadas nos dados informados e não garantem vendas ou resultados financeiros.</p>
      <h2>Responsabilidades</h2>
      <p>O estabelecimento é responsável pela veracidade dos dados cadastrados, por obter o consentimento de seus clientes e pelo conteúdo das mensagens enviadas.</p>
      <h2>Assinatura</h2>
      <p>Após o período de teste, o uso continuado depende de assinatura ativa. Sem assinatura ativa, os dados permanecem disponíveis para consulta e exportação, mas novos registros ficam bloqueados.</p>
      <h2>Cancelamento</h2>
      <p>Você pode cancelar a qualquer momento, sem multa.</p>
    </LegalLayout>
  )
}

export function NotFoundPage() {
  useDocumentTitle('Página não encontrada')
  return (
    <div className="grid min-h-dvh place-items-center bg-bg px-5 text-center">
      <div>
        <Compass className="mx-auto size-8 text-subtle" />
        <h1 className="mt-4 text-xl font-semibold">Página não encontrada</h1>
        <p className="mt-2 text-sm text-muted">O endereço pode estar incorreto ou a página foi removida.</p>
        <Button className="mt-6" asChild><Link to="/">Voltar ao início</Link></Button>
      </div>
    </div>
  )
}
