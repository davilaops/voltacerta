import * as React from 'react'
import { Link } from 'react-router-dom'
import { Compass } from 'lucide-react'
import { Logo } from '@/components/brand/Logo'
import { Button } from '@/components/ui/button'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from '@/lib/contact'

function LegalLayout({ title, children }: { title: string; children: React.ReactNode }) {
  useDocumentTitle(title)
  return (
    <div className="min-h-dvh bg-bg px-5 py-10">
      <div className="mx-auto max-w-2xl">
        <Link to="/"><Logo /></Link>
        <h1 className="mt-10 text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-xs text-subtle">Última atualização: {LAST_UPDATE}</p>
        <div className="mt-8 space-y-5 text-sm leading-relaxed text-muted [&_h2]:mt-8 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-fg [&_a]:text-fg [&_a]:underline">{children}</div>
      </div>
    </div>
  )
}

const LAST_UPDATE = '13 de novembro de 2026'

function ContactLink() {
  return <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a>
}

export function PrivacyPage() {
  return (
    <LegalLayout title="Política de Privacidade">
      <p>O VoltaCerta trata dados pessoais conforme a Lei Geral de Proteção de Dados (Lei nº 13.709/2018). Para qualquer dúvida ou solicitação sobre seus dados, fale com o responsável pelo serviço pelo e-mail <ContactLink />.</p>
      <h2>Dados dos usuários</h2>
      <p>Coletamos nome, e-mail e dados do estabelecimento para criar e operar sua conta, autenticar o acesso e cobrar a assinatura. Na contratação, também pedimos CPF ou CNPJ, exigido pelo processador de pagamentos para emitir a cobrança.</p>
      <h2>Pagamentos</h2>
      <p>As cobranças são processadas pelo Asaas (Pix, cartão ou boleto). Os dados de cartão são digitados diretamente no ambiente do Asaas e não passam nem ficam armazenados no VoltaCerta. Guardamos apenas o histórico da assinatura e dos pagamentos (plano, valor, data e situação).</p>
      <h2>Fornecedores</h2>
      <p>Para funcionar, o serviço utiliza fornecedores de infraestrutura: Supabase (banco de dados e autenticação), Vercel (hospedagem do site) e Asaas (pagamentos). Eles tratam os dados apenas para prestar esses serviços. Não vendemos dados pessoais.</p>
      <h2>Dados dos clientes do estabelecimento</h2>
      <p>O estabelecimento é o controlador dos dados de seus clientes (nome, telefone, e-mail opcional, pets e compras). O VoltaCerta atua como operador, tratando esses dados apenas para prever recompras e organizar contatos. Os dados de cada estabelecimento são isolados e nunca compartilhados com outros estabelecimentos.</p>
      <h2>Comunicação comercial</h2>
      <p>O sistema permite registrar consentimento e oposição ao contato. Contatos com clientes que se opuseram são bloqueados. Não realizamos disparos automáticos de mensagens.</p>
      <h2>Direitos dos titulares</h2>
      <p>É possível exportar e excluir os dados de um cliente a qualquer momento pelo painel. Proprietários podem solicitar a exclusão de todos os dados do estabelecimento em Configurações → Privacidade e dados.</p>
      <h2>Segurança</h2>
      <p>Aplicamos controle de acesso por organização no banco de dados, criptografia em trânsito e registro de auditoria das operações importantes.</p>
      <h2>Retenção</h2>
      <p>Os dados ficam guardados enquanto a conta existir. Quando o estabelecimento é excluído, seus dados são removidos. Podemos manter apenas o que a lei exige guardar, como registros fiscais e de pagamento.</p>
      <h2>Contato</h2>
      <p>Solicitações de acesso, correção ou exclusão de dados e dúvidas sobre esta política: <ContactLink />.</p>
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
      <p>A assinatura é mensal e renovada automaticamente. A cobrança é feita pelo Asaas, por Pix, cartão ou boleto. Os valores de cada plano estão na página de planos.</p>
      <h2>Cancelamento</h2>
      <p>Você pode cancelar a qualquer momento, sem multa, pedindo pelo e-mail <ContactLink />. Depois do cancelamento não há novas cobranças, e o acesso continua até o fim do período já pago.</p>
      <h2>Alterações</h2>
      <p>Estes termos podem ser atualizados. Mudanças importantes serão avisadas por e-mail ou dentro do sistema.</p>
      <h2>Contato</h2>
      <p>Dúvidas, suporte e solicitações: <ContactLink />.</p>
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
