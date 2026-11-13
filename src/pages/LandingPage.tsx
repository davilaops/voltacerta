import * as React from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  BarChart3,
  Bell,
  CalendarClock,
  Check,
  ChevronDown,
  ClipboardList,
  Menu as MenuIcon,
  MessageCircle,
  PackageSearch,
  RefreshCcw,
  ShieldCheck,
  Smartphone,
  TrendingDown,
  UserRoundX,
  Users,
  X,
} from 'lucide-react'
import { Logo } from '@/components/brand/Logo'
import { Button } from '@/components/ui/button'
import { AppLink } from '@/components/shared/AppLink'
import { customerLimitLabel, formatCents, usePlans } from '@/features/billing/plans'
import { cn } from '@/lib/utils'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from '@/lib/contact'

const NAV = [
  { href: '#como-funciona', label: 'Como funciona' },
  { href: '#funcionalidades', label: 'Funcionalidades' },
  { href: '#planos', label: 'Planos' },
  { href: '#perguntas', label: 'Perguntas' },
]

function Section({ id, eyebrow, title, subtitle, children, className }: { id?: string; eyebrow?: string; title: string; subtitle?: string; children: React.ReactNode; className?: string }) {
  return (
    <section id={id} className={cn('scroll-mt-20 px-5 py-20 sm:py-28', className)}>
      <div className="mx-auto max-w-6xl">
        <div className="mx-auto max-w-2xl text-center">
          {eyebrow && <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-brand">{eyebrow}</p>}
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-fg sm:text-4xl">{title}</h2>
          {subtitle && <p className="mt-4 text-base text-muted sm:text-lg">{subtitle}</p>}
        </div>
        <div className="mt-14">{children}</div>
      </div>
    </section>
  )
}

/** Ilustração estática do painel (dados de exemplo, rotulados como demonstração). */
function DashboardPreview() {
  const rows = [
    { name: 'Mariana Alves', product: 'Ração Golden Adulto 15kg', stage: 'Atrasada', tone: 'text-[#ff7a7a] bg-danger/10 border-danger/25', when: 'há 3 dias' },
    { name: 'Carlos Pereira', product: 'Areia Pipicat 4kg', stage: 'Hoje', tone: 'text-warning bg-warning/10 border-warning/25', when: 'hoje' },
    { name: 'Juliana Costa', product: 'Antipulgas NexGard M', stage: 'Próxima', tone: 'text-info bg-info/10 border-info/25', when: 'em 4 dias' },
  ]
  return (
    <div className="relative mx-auto max-w-5xl">
      <div className="pointer-events-none absolute -inset-x-10 -top-10 bottom-0 rounded-[40px] opacity-70 blur-3xl" style={{ background: 'radial-gradient(50% 50% at 50% 30%, rgb(34 197 139 / 0.18), transparent)' }} />
      <div className="relative overflow-hidden rounded-xl border border-border bg-surface shadow-pop">
        <div className="flex items-center gap-1.5 border-b border-border bg-bg/60 px-4 py-2.5">
          <span className="size-2.5 rounded-full bg-surface-3" />
          <span className="size-2.5 rounded-full bg-surface-3" />
          <span className="size-2.5 rounded-full bg-surface-3" />
          <span className="ml-3 text-[11px] text-subtle">Demonstração ilustrativa</span>
        </div>
        <div className="grid gap-4 p-4 sm:p-6 md:grid-cols-[1fr_300px]">
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              {[
                { l: 'Contatar hoje', v: '12' },
                { l: 'Recompras previstas', v: '48' },
                { l: 'Taxa de recompra', v: '64%' },
              ].map((s) => (
                <div key={s.l} className="rounded-lg border border-border bg-bg/40 p-3">
                  <div className="truncate text-[11px] text-muted">{s.l}</div>
                  <div className="mt-1 text-xl font-semibold tabular">{s.v}</div>
                </div>
              ))}
            </div>
            <div className="rounded-lg border border-border bg-bg/40">
              <div className="border-b border-border px-4 py-2.5 text-[13px] font-semibold">Clientes que precisam de atenção</div>
              {rows.map((r) => (
                <div key={r.name} className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-0">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium">{r.name}</div>
                    <div className="truncate text-[11px] text-muted">{r.product} · {r.when}</div>
                  </div>
                  <span className={cn('hidden rounded-full border px-2 py-0.5 text-[11px] font-medium sm:inline', r.tone)}>{r.stage}</span>
                  <span className="grid size-7 place-items-center rounded-md border border-[#22c55e]/30 bg-[#1f9d55]/15 text-[#4ade80]">
                    <MessageCircle className="size-3.5" />
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="hidden rounded-lg border border-border bg-bg/40 p-4 md:block">
            <div className="text-[13px] font-semibold">Mensagem pronta</div>
            <div className="mt-3 rounded-lg rounded-tl-none bg-[#0b3d2e] p-3 text-[12.5px] leading-relaxed text-[#e7fbef]">
              Olá, Mariana! Tudo bem? Estamos passando para saber se você está precisando repor Ração Golden Adulto 15kg para seu pet. Podemos separar para você!
            </div>
            <div className="mt-4 flex h-8 items-center justify-center gap-2 rounded-md bg-[#1f9d55]/20 text-[12px] font-medium text-[#4ade80]">
              <MessageCircle className="size-3.5" /> Abrir WhatsApp
            </div>
            <div className="mt-6 space-y-2">
              {[78, 52, 91, 64, 40, 70, 85].map((h, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="h-1.5 rounded-full bg-brand/80" style={{ width: `${h}%` }} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Faq({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = React.useState(false)
  return (
    <div className="border-b border-border">
      <button className="flex w-full items-center justify-between gap-4 py-5 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="text-[15px] font-medium text-fg">{q}</span>
        <ChevronDown className={cn('size-4 shrink-0 text-muted transition-transform', open && 'rotate-180')} />
      </button>
      <div className={cn('grid transition-all duration-300', open ? 'grid-rows-[1fr] pb-5 opacity-100' : 'grid-rows-[0fr] opacity-0')}>
        <p className="overflow-hidden text-sm leading-relaxed text-muted">{a}</p>
      </div>
    </div>
  )
}

/** Planos lidos da tabela public.plans (fonte única de preços). */
function PlansGrid() {
  const plans = usePlans()
  if (plans.isError || (!plans.isLoading && !plans.data?.length)) {
    return (
      <div className="mx-auto max-w-md rounded-xl border border-border bg-surface p-6 text-center text-sm text-muted">
        Não foi possível carregar os planos agora. Crie sua conta e teste grátis por 14 dias.
        <Button className="mt-4 w-full" asChild><AppLink to="/cadastro">Começar teste grátis</AppLink></Button>
      </div>
    )
  }
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {plans.isLoading
        ? [0, 1, 2].map((i) => <div key={i} className="h-96 animate-pulse rounded-xl border border-border bg-surface" />)
        : plans.data!.map((p) => (
            <div key={p.id} className={cn('relative flex flex-col rounded-xl border bg-surface p-7', p.highlight ? 'border-brand/50 shadow-[0_0_0_1px_rgb(34_197_139/0.2),0_20px_50px_-20px_rgb(34_197_139/0.35)]' : 'border-border')}>
              {p.highlight && <span className="absolute -top-3 left-7 rounded-full bg-brand px-2.5 py-0.5 text-[11px] font-semibold text-brand-fg">Mais escolhido</span>}
              <h3 className="text-base font-semibold">{p.name}</h3>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-4xl font-semibold tracking-tight tabular">{formatCents(p.price_cents)}</span>
                <span className="text-sm text-muted">/mês</span>
              </div>
              <p className="mt-1.5 text-sm text-muted">{customerLimitLabel(p.customer_limit)}</p>
              <ul className="mt-6 flex-1 space-y-3 text-sm">
                {p.highlights.map((f) => <li key={f} className="flex gap-2.5"><Check className="mt-0.5 size-4 shrink-0 text-brand" />{f}</li>)}
              </ul>
              <Button className="mt-8 w-full" variant={p.highlight ? 'primary' : 'secondary'} asChild>
                <AppLink to="/cadastro">Começar teste grátis</AppLink>
              </Button>
            </div>
          ))}
    </div>
  )
}

export function LandingPage() {
  useDocumentTitle('')
  const [menu, setMenu] = React.useState(false)

  return (
    <div className="min-h-dvh bg-bg text-fg">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-bg/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <Link to="/" aria-label="VoltaCerta — início"><Logo /></Link>
          <nav className="hidden items-center gap-7 md:flex">
            {NAV.map((n) => <a key={n.href} href={n.href} className="text-sm text-muted transition-colors hover:text-fg">{n.label}</a>)}
          </nav>
          <div className="hidden items-center gap-2 md:flex">
            <Button variant="ghost" asChild><AppLink to="/entrar">Entrar</AppLink></Button>
            <Button asChild><AppLink to="/cadastro">Começar agora</AppLink></Button>
          </div>
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setMenu((m) => !m)} aria-label="Menu">
            {menu ? <X /> : <MenuIcon />}
          </Button>
        </div>
        {menu && (
          <div className="border-t border-border px-5 py-4 md:hidden animate-fade-in">
            <nav className="flex flex-col gap-1">
              {NAV.map((n) => <a key={n.href} href={n.href} onClick={() => setMenu(false)} className="rounded-md px-2 py-2.5 text-sm text-muted hover:bg-surface-2">{n.label}</a>)}
            </nav>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button variant="secondary" asChild><AppLink to="/entrar">Entrar</AppLink></Button>
              <Button asChild><AppLink to="/cadastro">Começar agora</AppLink></Button>
            </div>
          </div>
        )}
      </header>

      <main>
        {/* Hero */}
        <section className="relative overflow-hidden px-5 pb-20 pt-16 sm:pb-28 sm:pt-24">
          <div className="pointer-events-none absolute inset-0" style={{ backgroundImage: 'linear-gradient(rgb(38 50 71 / 0.35) 1px, transparent 1px), linear-gradient(90deg, rgb(38 50 71 / 0.35) 1px, transparent 1px)', backgroundSize: '56px 56px', maskImage: 'radial-gradient(ellipse 70% 50% at 50% 0%, black, transparent)' }} />
          <div className="relative mx-auto max-w-4xl text-center page-enter">
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs text-muted">
              <span className="size-1.5 rounded-full bg-brand" /> Recompra inteligente para pet shops
            </span>
            <h1 className="mt-6 text-4xl font-semibold leading-[1.08] tracking-tight sm:text-6xl">
              Seus clientes não precisam lembrar de voltar.{' '}
              <span className="text-brand">O VoltaCerta lembra por você.</span>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-base text-muted sm:text-lg">
              Identifique quando seus clientes estão próximos de precisar de novos produtos e transforme oportunidades de recompra em novas vendas.
            </p>
            <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
              <Button size="lg" asChild><AppLink to="/cadastro">Começar agora <ArrowRight /></AppLink></Button>
              <Button size="lg" variant="secondary" asChild><a href="#como-funciona">Conhecer a plataforma</a></Button>
            </div>
            <p className="mt-4 text-xs text-subtle">14 dias grátis · sem cartão de crédito · cancele quando quiser</p>
          </div>
          <div className="relative mt-16 sm:mt-20">
            <DashboardPreview />
          </div>
        </section>

        {/* Problema */}
        <Section eyebrow="O problema" title="A venda que você não vê é a que mais se perde" subtitle="Ração, areia e antipulgas acabam em datas previsíveis. Quando ninguém lembra o cliente, ele compra no primeiro lugar que aparecer.">
          <div className="grid gap-4 md:grid-cols-3">
            {[
              { icon: UserRoundX, title: 'Clientes somem sem aviso', text: 'Sem acompanhamento, você só percebe que o cliente parou de comprar meses depois.' },
              { icon: TrendingDown, title: 'Recompra fica para a concorrência', text: 'O produto acaba e o tutor resolve no supermercado ou no aplicativo mais próximo.' },
              { icon: ClipboardList, title: 'Controle no caderno não escala', text: 'Planilhas e anotações não dizem quem precisa de contato hoje.' },
            ].map(({ icon: Icon, title, text }) => (
              <div key={title} className="rounded-xl border border-border bg-surface p-6">
                <Icon className="size-5 text-danger" />
                <h3 className="mt-4 text-base font-semibold">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{text}</p>
              </div>
            ))}
          </div>
        </Section>

        {/* Como funciona */}
        <Section id="como-funciona" eyebrow="Como funciona" title="Três passos para nunca mais perder uma recompra" className="bg-surface/40">
          <ol className="grid gap-4 md:grid-cols-3">
            {[
              { n: '01', icon: PackageSearch, title: 'Cadastre produtos e duração', text: 'Informe quanto tempo cada produto costuma durar: ração 15 kg, 35 dias; areia, 20 dias.' },
              { n: '02', icon: CalendarClock, title: 'Registre as compras', text: 'O VoltaCerta calcula quando cada produto vai acabar, ajustando pela quantidade e pelo histórico do cliente.' },
              { n: '03', icon: MessageCircle, title: 'Contate no momento certo', text: 'Veja quem precisa de contato hoje e abra o WhatsApp com a mensagem pronta.' },
            ].map(({ n, icon: Icon, title, text }) => (
              <li key={n} className="relative rounded-xl border border-border bg-surface p-6">
                <span className="text-xs font-semibold tabular text-subtle">{n}</span>
                <Icon className="mt-4 size-5 text-brand" />
                <h3 className="mt-3 text-base font-semibold">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{text}</p>
              </li>
            ))}
          </ol>
        </Section>

        {/* Demonstração */}
        <Section eyebrow="Demonstração do painel" title="Tudo o que importa em uma tela" subtitle="Indicadores calculados com os dados reais da sua loja: quem comprar, quando e quanto foi recuperado.">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {[
              { icon: Bell, title: 'Clientes para contatar hoje', text: 'Previsões vencidas organizadas por urgência.' },
              { icon: RefreshCcw, title: 'Central de recompras', text: 'Próximas, para hoje, atrasadas e concluídas.' },
              { icon: BarChart3, title: 'Receita recuperada', text: 'Vendas concluídas após contato, separadas do valor potencial.' },
              { icon: Users, title: 'Histórico do cliente', text: 'Pets, compras, contatos e próximas recompras.' },
            ].map(({ icon: Icon, title, text }) => (
              <div key={title} className="rounded-xl border border-border bg-surface p-5">
                <span className="grid size-9 place-items-center rounded-lg border border-border bg-surface-2 text-brand"><Icon className="size-4" /></span>
                <h3 className="mt-4 text-sm font-semibold">{title}</h3>
                <p className="mt-1.5 text-[13px] text-muted">{text}</p>
              </div>
            ))}
          </div>
        </Section>

        {/* Benefícios */}
        <Section eyebrow="Benefícios" title="Mais recorrência, menos clientes perdidos" className="bg-surface/40">
          <div className="mx-auto grid max-w-4xl gap-x-10 gap-y-5 sm:grid-cols-2">
            {[
              'Não perca oportunidades de recompra',
              'Organize seus clientes e pets em um só lugar',
              'Saiba exatamente quem precisa de contato',
              'Recupere clientes que pararam de comprar',
              'Aumente a recorrência de compras',
              'Acompanhe resultados com dados reais',
            ].map((b) => (
              <div key={b} className="flex items-start gap-3">
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-brand/15"><Check className="size-3 text-brand" /></span>
                <span className="text-[15px] text-fg/90">{b}</span>
              </div>
            ))}
          </div>
        </Section>

        {/* Funcionalidades */}
        <Section id="funcionalidades" eyebrow="Funcionalidades" title="Feito para a rotina do pet shop">
          <div className="grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
            {[
              { icon: CalendarClock, title: 'Previsão inteligente', text: 'Combina duração do produto, quantidade e intervalo real entre compras, sem oscilar com poucos dados.' },
              { icon: MessageCircle, title: 'WhatsApp com um clique', text: 'Modelos de mensagem personalizáveis com nome do cliente, produto e pet.' },
              { icon: Users, title: 'CRM de clientes e pets', text: 'Vários pets por cliente, histórico completo e busca por nome ou telefone.' },
              { icon: BarChart3, title: 'Relatórios com exportação', text: 'Vendas, produtos mais vendidos, clientes inativos e taxa de recuperação em CSV.' },
              { icon: ShieldCheck, title: 'Dados protegidos e LGPD', text: 'Isolamento por estabelecimento, consentimento e bloqueio de contato registrados.' },
              { icon: Smartphone, title: 'Funciona no celular', text: 'Acompanhe e contate clientes de qualquer lugar, direto do balcão.' },
            ].map(({ icon: Icon, title, text }) => (
              <div key={title} className="bg-surface p-6">
                <Icon className="size-5 text-brand" />
                <h3 className="mt-4 text-[15px] font-semibold">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{text}</p>
              </div>
            ))}
          </div>
        </Section>

        {/* Planos */}
        <Section id="planos" eyebrow="Planos" title="Simples, sem taxa de adesão" subtitle="Comece com 14 dias grátis com todos os recursos do plano Profissional." className="bg-surface/40">
          <PlansGrid />
        </Section>

        {/* FAQ */}
        <Section id="perguntas" eyebrow="Perguntas frequentes" title="Dúvidas comuns">
          <div className="mx-auto max-w-3xl border-t border-border">
            {[
              { q: 'Preciso instalar alguma coisa?', a: 'Não. O VoltaCerta funciona no navegador do computador e do celular.' },
              { q: 'As mensagens são enviadas automaticamente?', a: 'Não. Você revisa e envia cada mensagem pelo seu WhatsApp. Isso mantém o contato pessoal e evita disparos indesejados.' },
              { q: 'Como o sistema sabe quando o produto vai acabar?', a: 'Você informa a duração média de cada produto. A previsão considera a quantidade comprada e, com o tempo, o intervalo real entre as compras de cada cliente.' },
              { q: 'O VoltaCerta substitui meu sistema de vendas?', a: 'Não é um ERP. Ele é focado em recompra e recuperação de clientes, e pode ser usado junto com o sistema que você já tem.' },
              { q: 'Meus dados ficam seguros?', a: 'Cada estabelecimento tem seus dados isolados com regras de acesso no próprio banco de dados. Você pode exportar ou excluir dados de clientes quando precisar.' },
              { q: 'Posso cancelar quando quiser?', a: 'Sim. Não há fidelidade nem taxa de cancelamento.' },
            ].map((f) => <Faq key={f.q} {...f} />)}
          </div>
        </Section>

        {/* CTA final */}
        <section className="px-5 pb-24">
          <div className="relative mx-auto max-w-5xl overflow-hidden rounded-2xl border border-border bg-surface px-6 py-16 text-center sm:px-16">
            <div className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(60% 80% at 50% 0%, rgb(34 197 139 / 0.14), transparent)' }} />
            <h2 className="relative text-3xl font-semibold tracking-tight sm:text-4xl">Comece a trazer seus clientes de volta</h2>
            <p className="relative mx-auto mt-4 max-w-xl text-muted">Configure em poucos minutos e veja quem precisa de contato ainda hoje.</p>
            <Button size="lg" className="relative mt-8" asChild><AppLink to="/cadastro">Começar agora <ArrowRight /></AppLink></Button>
          </div>
        </section>
      </main>

      <footer className="border-t border-border px-5 py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
          <div>
            <Logo />
            <p className="mt-2 text-xs text-subtle">Recompra inteligente para pet shops.</p>
          </div>
          <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted">
            <a href="#planos" className="hover:text-fg">Planos</a>
            <Link to="/privacidade" className="hover:text-fg">Privacidade</Link>
            <Link to="/termos" className="hover:text-fg">Termos de uso</Link>
            <AppLink to="/entrar" className="hover:text-fg">Entrar</AppLink>
            <a href={SUPPORT_MAILTO} className="hover:text-fg">Contato: {SUPPORT_EMAIL}</a>
          </nav>
          <p className="text-xs text-subtle">© {new Date().getFullYear()} VoltaCerta</p>
        </div>
      </footer>
    </div>
  )
}
