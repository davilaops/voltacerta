import { Link } from 'react-router-dom'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { PageHeader } from '@/components/ui/states'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from '@/lib/contact'

const STEPS = [
  { title: '1. Cadastre seus produtos', text: 'Informe a duração média de cada produto (ex.: ração 15 kg dura 35 dias). Esse dado é a base da previsão.', to: '/app/produtos' },
  { title: '2. Cadastre clientes e pets', text: 'Use o telefone com DDD — ele evita duplicidade e permite abrir o WhatsApp com um clique.', to: '/app/clientes' },
  { title: '3. Registre as compras', text: 'A cada compra o sistema calcula quando o produto deve acabar, considerando quantidade e histórico.', to: '/app/compras' },
  { title: '4. Contate quem precisa', text: 'Na Recuperação de clientes você vê quem está próximo ou atrasado e envia a mensagem pelo WhatsApp.', to: '/app/recuperacao' },
]

const FAQ = [
  { q: 'Como a previsão é calculada?', a: 'Data prevista = data da compra + duração média do produto × quantidade. Quando o cliente tem histórico suficiente (2 intervalos por padrão), o intervalo real entre as compras dele entra no cálculo com peso crescente, limitado a 70%. Intervalos fora do normal são limitados para não distorcer a previsão.' },
  { q: 'O que é uma venda recuperada?', a: 'É uma recompra concluída até 30 dias (configurável) depois de um contato registrado com o cliente. Recompras sem contato contam como recompras espontâneas e não entram na receita recuperada.' },
  { q: 'O sistema envia mensagens automaticamente?', a: 'Não. O VoltaCerta abre o WhatsApp com a mensagem pronta e você envia. O contato só é registrado quando você confirma o resultado.' },
  { q: 'E se o cliente comprar antes da data prevista?', a: 'A previsão anterior é encerrada como recompra concluída e uma nova previsão é criada a partir da nova compra, sem duplicar registros.' },
  { q: 'Posso alterar os prazos de “próxima” e “atrasada”?', a: 'Sim, em Configurações → Recompras.' },
  { q: 'Como funciona o estoque?', a: 'Registre a entrada de mercadoria de um produto em Estoque. A partir daí, cada venda (registrada, no caixa ou na agenda) baixa o saldo automaticamente. A aba “Sugestão de compra” mostra quanto pedir ao fornecedor considerando as recompras previstas dos seus clientes, a média de vendas e o estoque mínimo.' },
  { q: 'Como uso a agenda de banho e tosa?', a: 'Cadastre os serviços (com preço e duração) e os profissionais em Serviços e pacotes. Na Agenda, crie os atendimentos; o sistema impede dois atendimentos ao mesmo tempo para o mesmo profissional. Ao concluir, você registra o pagamento ou usa uma sessão do pacote do cliente.' },
  { q: 'Como funcionam os pacotes?', a: 'Crie um pacote (ex.: 4 banhos por mês) e venda ao cliente. O valor entra no financeiro na hora da venda e cada atendimento concluído com o pacote desconta uma sessão. O cliente recebe lembrete quando o pacote está perto de vencer.' },
  { q: 'O que é o Caixa?', a: 'É o ponto de venda do balcão: abra o caixa com o troco inicial, venda produtos e serviços (com cliente identificado ou consumidor final), receba em várias formas de pagamento e feche o caixa conferindo o dinheiro da gaveta.' },
  { q: 'Como divulgo a loja online?', a: 'Em Configurações → Loja online, escolha o endereço e publique o catálogo e/ou o agendamento online. Coloque o link no Instagram, Google e WhatsApp. Os pedidos de agendamento chegam na Agenda para você confirmar.' },
  { q: 'O WhatsApp pode enviar sozinho?', a: 'Sim, com a API oficial do WhatsApp Business (Meta). Configure em Configurações → Integrações. Sem a integração, todos os lembretes continuam disponíveis para envio em um clique pelo seu WhatsApp.' },
  { q: 'Consigo emitir nota fiscal?', a: 'Sim, NFC-e para produtos e NFS-e para serviços, pela Focus NFe. É preciso ter CNPJ, certificado digital A1 e cadastro na Focus. Configure em Configurações → Integrações e confirme os dados tributários com seu contador.' },
]

export function HelpPage() {
  useDocumentTitle('Ajuda')
  return (
    <>
      <PageHeader title="Ajuda" description="Como tirar o máximo do VoltaCerta." />
      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        {STEPS.map((s) => (
          <Link key={s.title} to={s.to} className="rounded-lg border border-border bg-surface p-5 transition-colors hover:border-border-strong">
            <h3 className="text-sm font-semibold">{s.title}</h3>
            <p className="mt-1.5 text-[13px] text-muted">{s.text}</p>
          </Link>
        ))}
      </div>
      <Card>
        <CardHeader title="Perguntas frequentes" />
        <CardBody className="divide-y divide-border">
          {FAQ.map((f) => (
            <details key={f.q} className="group py-3">
              <summary className="cursor-pointer list-none text-sm font-medium marker:hidden">{f.q}</summary>
              <p className="mt-2 text-[13px] leading-relaxed text-muted">{f.a}</p>
            </details>
          ))}
        </CardBody>
      </Card>
      <Card className="mt-6">
        <CardHeader title="Precisa de ajuda?" />
        <CardBody>
          <p className="text-[13px] text-muted">
            Fale com o suporte pelo e-mail{' '}
            <a href={SUPPORT_MAILTO} className="font-medium text-fg underline">{SUPPORT_EMAIL}</a>.
          </p>
        </CardBody>
      </Card>
    </>
  )
}
