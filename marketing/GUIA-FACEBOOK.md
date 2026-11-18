# Vender o VoltaCerta no Facebook e no Instagram

Tudo o que é preciso para a primeira campanha: configuração, textos, artes e o que acompanhar.
As artes ficam em `marketing/artes/` e as telas usadas nelas são do modo demonstração (dados fictícios).

## 1. O que só você pode fazer

| Passo | Onde | Por quê |
|---|---|---|
| Entrar na sua conta do Facebook | navegador do Claude (painel ao lado), não no Opera | é a única janela que eu consigo operar |
| Aceitar os termos da Meta ao criar a página e a conta de anúncios | Facebook | aceite de termos é seu |
| Cadastrar o cartão ou Pix e definir o orçamento | Gerenciador de Anúncios → Cobrança | pagamento é seu |
| Dar o ok antes de publicar posts e anúncios | aqui no chat | publicação em seu nome |

Todo o resto eu faço: criar a página, preencher a bio, criar o Pixel, montar a campanha e subir as artes e os textos.

## 2. Página do Facebook e perfil do Instagram

- **Nome:** VoltaCerta
- **Categoria:** Software (ou "Empresa de software")
- **Foto de perfil:** o logotipo (quadrado verde com o "✓")
- **Capa:** `og-image.png` (mesma imagem do link do site)
- **Bio (até 150 caracteres):**
  > Sistema para pet shop: lembra quando o cliente vai precisar de ração, agenda de banho e tosa, caixa e estoque. 14 dias grátis 👇
- **Link:** https://voltacerta-brown.vercel.app/?utm_source=instagram&utm_medium=bio
- **Botão de ação:** "Cadastre-se", apontando para o mesmo link
- **Contato:** solucoesgeniais01@gmail.com

## 3. Pixel (medição)

1. Gerenciador de Eventos → Conectar fontes de dados → Web → "Meta Pixel" → nome **VoltaCerta Site**.
2. Escolher "Instalar o código manualmente" e copiar **só o número do Pixel** (15 a 16 dígitos).
3. O número vai no arquivo `.env.production` como `VITE_META_PIXEL_ID` e o site é publicado de novo (eu faço).

O site já envia estes eventos, sempre com consentimento do visitante (aviso de cookies):

| Evento | Quando |
|---|---|
| `PageView` | visita ao site, cadastro ou login |
| `CompleteRegistration` | cadastro concluído (principal evento da campanha) |
| `StartTrial` | estabelecimento criado, começa o teste de 14 dias |
| `Purchase` | assinatura paga (com o valor do plano) |

Nada é medido dentro do painel nem nas lojas online dos pet shops. Nenhum dado pessoal vai para a Meta.
Cada cadastro também guarda de qual anúncio veio (`utm_*`), mesmo para quem recusar os cookies.

## 4. Campanha de teste

| Item | Configuração |
|---|---|
| Objetivo | **Cadastros (Leads)**, local da conversão **Site**, evento **CompleteRegistration** |
| Nome | `VC | Cadastro | Teste 1` |
| Orçamento | **R$ 20 por dia** no conjunto de anúncios, sem data de término (pausar manualmente) |
| Público | Brasil · 22 a 60 anos · Público Advantage+ ligado, com sugestões: *Pet shop*, *Banho e tosa*, *Medicina veterinária*, *Petz*, *Cobasi*, *Administradores de página de pequenas empresas* |
| Posicionamentos | Advantage+ (automático) |
| Anúncios | 3 anúncios, cada um com a arte de feed + a de story |
| Link | `https://voltacerta-brown.vercel.app/` |
| Parâmetros de URL | `utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.name}}&utm_content={{ad.name}}` |
| Botão | "Cadastre-se" |

**Por que assim:** com R$ 20 por dia, um único conjunto de anúncios concentra o aprendizado da Meta.
Dividir em vários públicos espalharia o pouco orçamento e nenhum aprenderia.

**Se o Pixel ainda não tiver dados** e a Meta não entregar os anúncios nos primeiros 2 dias,
troque a otimização para **Visualizações da página de destino** e volte para cadastros depois dos primeiros 20 cadastros.

## 5. Os 3 anúncios

### Anúncio A — Recompra (`feed-1-recompra.png` + `story-1-recompra.png`)

**Texto principal:**
> Seu cliente comprou ração mês passado. Daqui a alguns dias ela acaba — e ele vai comprar de alguém.
>
> O VoltaCerta avisa o dia certo de chamar cada cliente no WhatsApp, com a mensagem pronta. Você só aperta enviar.
>
> ✅ Previsão de recompra por cliente e produto
> ✅ Lembrete de aniversário do pet e pós-venda
> ✅ Funciona no celular, direto do balcão
>
> Teste grátis por 14 dias, sem cartão de crédito.

**Título:** Chame o cliente antes do supermercado
**Descrição:** 14 dias grátis · sem cartão

### Anúncio B — Sistema completo (`feed-2-completo.png` + `story-2-completo.png`)

**Texto principal:**
> Agenda de banho e tosa, caixa, estoque, financeiro e WhatsApp num sistema só — feito para pet shop.
>
> 📅 Agenda por profissional, sem horário duplicado, com pacotes
> 💰 Caixa com Pix, cartão, dinheiro e fiado
> 📦 Estoque que baixa sozinho e sugere o que comprar
> 🔔 Lembra quando cada cliente vai precisar de ração de novo
>
> A partir de R$ 39,90 por mês. Teste 14 dias grátis.

**Título:** Sistema completo para pet shop
**Descrição:** A partir de R$ 39,90/mês

### Anúncio C — Preço (`feed-3-funcionalidades.png` + `story-2-completo.png`)

**Texto principal:**
> Quanto custa perder um cliente fiel? Cada saco de ração que ele deixa de comprar com você é uma venda que se repetiria todo mês.
>
> Por R$ 69,90 por mês (menos de R$ 2,40 por dia), o VoltaCerta organiza o seu pet shop e traz o cliente de volta no momento certo.
>
> Sem taxa de adesão, sem fidelidade. Cancele quando quiser.

**Título:** Menos de R$ 2,40 por dia
**Descrição:** 14 dias grátis para testar

> Regras da Meta respeitadas: sem promessa de resultado financeiro, sem citar concorrentes,
> sem "você" ligado a característica pessoal. Os preços são os da página de planos.

## 6. Posts para a página (antes e durante os anúncios)

Ter alguns posts deixa a página com cara de empresa de verdade quando alguém clica no perfil.

| Dia | Arte | Legenda |
|---|---|---|
| 1 | `post-1-problema.png` | A ração do seu cliente vai acabar. A pergunta é: quem vai lembrar ele primeiro? O VoltaCerta avisa o dia certo de chamar cada cliente, com a mensagem pronta para o WhatsApp. Teste grátis por 14 dias — link na bio. |
| 2 | `feed-2-completo.png` | Agenda, caixa, estoque e WhatsApp num sistema só. Feito para a rotina do pet shop e do banho e tosa, e funciona no celular. A partir de R$ 39,90/mês. |
| 4 | `post-2-agenda.png` | Dois banhos marcados no mesmo horário? Não mais. A agenda do VoltaCerta separa por profissional, bloqueia conflito e manda lembrete na véspera. |
| 6 | `post-3-estoque.png` | Faltou ração do cliente fiel e ele foi buscar em outro lugar? O estoque do VoltaCerta mostra quanto pedir para cada fornecedor, com base nas recompras previstas. |
| 8 | `feed-1-recompra.png` | Cliente que some compra em outro lugar. Com o VoltaCerta você vê, todo dia, quem precisa de contato hoje. 14 dias grátis, sem cartão. |
| 10 | `feed-3-funcionalidades.png` | Tudo o que o seu pet shop precisa por menos de R$ 2,40 por dia. Sem adesão, sem fidelidade. |

Hashtags (no fim, 3 a 5): `#petshop #banhoetosa #gestaopetshop #empreendedorpet #sistemaparapetshop`

## 7. O que acompanhar

Olhe o Gerenciador de Anúncios a cada 2 ou 3 dias, não todo dia: a Meta precisa de tempo para aprender.

| Métrica | Sinal bom | O que fazer se estiver ruim |
|---|---|---|
| CTR (cliques no link ÷ impressões) | acima de 1% | trocar a arte do anúncio com pior CTR |
| Custo por cadastro | depende do mercado; compare entre os 3 anúncios | após 7 dias, pausar o anúncio mais caro |
| Cadastros → assinaturas | aparece no painel Super Admin | se muitos cadastram e ninguém assina, o problema está no produto ou no onboarding, não no anúncio |

Não existe número garantido de vendas. Os primeiros 7 a 14 dias servem para descobrir qual mensagem
funciona; depois disso vale aumentar o orçamento do anúncio vencedor aos poucos (no máximo 20% a cada 3 dias).

## 8. Regenerar as artes

As artes são geradas a partir de HTML. Para mudar texto ou preço, edite `marketing/fontes/gerar.py` e rode:

```bash
python marketing/fontes/gerar.py
```

Isso também atualiza `public/og-image.png`, a imagem que aparece quando o link do site é compartilhado.
