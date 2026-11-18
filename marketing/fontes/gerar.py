"""Gera as artes dos anúncios (HTML -> PNG com o Edge em modo headless).

uso: python marketing/fontes/gerar.py
As telas em marketing/fontes/telas são capturas do modo demonstração (dados fictícios).
"""
import os
import subprocess
import time
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'artes')
HTML_DIR = os.path.join(HERE, 'html')
EDGE = r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
os.makedirs(OUT, exist_ok=True)
os.makedirs(HTML_DIR, exist_ok=True)

CHECK = '<svg viewBox="0 0 32 32"><path d="M9 16.5l4.5 4.5L23 11.5" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'

BASE_CSS = """
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:%(w)dpx;height:%(h)dpx;overflow:hidden}
body{font-family:Inter,Arial,sans-serif;background:#090d16;color:#f8fafc;position:relative;-webkit-font-smoothing:antialiased}
.glow{position:absolute;inset:0;background:radial-gradient(60%% 45%% at 50%% 0%%,rgba(34,197,139,.22),transparent 70%%),radial-gradient(50%% 40%% at 100%% 100%%,rgba(34,197,139,.10),transparent 70%%)}
.grid{position:absolute;inset:0;background-image:linear-gradient(rgba(38,50,71,.35) 1px,transparent 1px),linear-gradient(90deg,rgba(38,50,71,.35) 1px,transparent 1px);background-size:64px 64px;-webkit-mask-image:radial-gradient(ellipse 80%% 55%% at 50%% 0%%,#000,transparent)}
.wrap{position:relative;height:100%%;display:flex;flex-direction:column;padding:%(pad)dpx}
.logo{display:flex;align-items:center;gap:16px;font-weight:700;font-size:%(logo)dpx;letter-spacing:-.02em}
.mark{width:%(mark)dpx;height:%(mark)dpx;border-radius:%(markr)dpx;background:#22c58b;color:#04130d;display:grid;place-items:center}
.mark svg{width:70%%;height:70%%}
h1{font-weight:800;letter-spacing:-.035em;line-height:1.04}
.g{color:#22c58b}
.sub{color:#a7b3c6;line-height:1.35}
.pill{display:inline-flex;align-items:center;gap:12px;border:1.5px solid #263247;background:rgba(17,24,39,.8);border-radius:999px;padding:12px 24px;color:#cbd5e1;font-weight:500}
.dot{width:12px;height:12px;border-radius:50%%;background:#22c58b}
.cta{display:inline-flex;align-items:center;justify-content:center;gap:14px;background:#22c58b;color:#04130d;font-weight:700;border-radius:18px;box-shadow:0 20px 50px -12px rgba(34,197,139,.55)}
.phone{border-radius:64px;padding:14px;background:linear-gradient(160deg,#2a3650,#121a2b);box-shadow:0 40px 90px -20px rgba(0,0,0,.8),0 0 0 2px #1e2a40;overflow:hidden}
.phone img{display:block;width:100%%;border-radius:50px;object-fit:cover;object-position:top}
.desk{border-radius:22px;border:2px solid #263247;background:#111827;box-shadow:0 40px 90px -20px rgba(0,0,0,.85);overflow:hidden}
.desk .bar{height:38px;display:flex;align-items:center;gap:10px;padding:0 18px;background:#0d1320;border-bottom:1.5px solid #1e2a40}
.desk .bar i{width:12px;height:12px;border-radius:50%%;background:#263247}
.desk img{display:block;width:100%%;object-fit:cover;object-position:top left}
.checks{display:flex;flex-direction:column}
.checks div{display:flex;align-items:center;font-weight:500;color:#e2e8f0}
.checks span{flex-shrink:0;border-radius:50%%;background:rgba(34,197,139,.16);color:#22c58b;display:grid;place-items:center}
.checks span svg{width:62%%;height:62%%}
.note{color:#64748b;font-size:20px}
.price b{color:#f8fafc}
"""


def page(name, w, h, body, pad=72, logo=40, mark=60, extra_css=''):
    css = BASE_CSS % {'w': w, 'h': h, 'pad': pad, 'logo': logo, 'mark': mark, 'markr': mark // 4}
    html = f'''<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>{css}{extra_css}</style></head>
<body><div class="glow"></div><div class="grid"></div><div class="wrap">{body}</div></body></html>'''
    path = os.path.join(HTML_DIR, name + '.html')
    with open(path, 'w', encoding='utf-8') as f:
        f.write(html)
    return path, w, h


def logo_html():
    return f'<div class="logo"><span class="mark">{CHECK}</span>VoltaCerta</div>'


def checks(items, size=34, gap=22, font=34):
    rows = ''.join(f'<div style="gap:{gap}px;font-size:{font}px"><span style="width:{size+12}px;height:{size+12}px">{CHECK}</span>{t}</div>' for t in items)
    return f'<div class="checks" style="gap:{gap}px">{rows}</div>'


T = '../telas/'
jobs = []

# 1) Feed 4:5 — recompra (dor principal)
jobs.append(page('feed-1-recompra', 1080, 1350, f'''
{logo_html()}
<h1 style="font-size:70px;margin-top:52px">Seu cliente vai precisar de <span class="g">ração de novo.</span><br>Quem vai lembrar ele primeiro?</h1>
<p class="sub" style="font-size:34px;margin-top:28px;max-width:900px">O VoltaCerta avisa o dia certo de chamar cada cliente no WhatsApp, com a mensagem pronta.</p>
<div style="flex:1;position:relative;margin-top:48px">
  <div class="phone" style="position:absolute;left:50%;transform:translateX(-50%);width:520px;top:0;height:900px"><img src="{T}m-recompras.png" style="height:872px"></div>
</div>
<div style="position:absolute;left:72px;right:72px;bottom:64px;display:flex;align-items:center;justify-content:space-between;background:rgba(9,13,22,.92);border:1.5px solid #263247;border-radius:26px;padding:26px 30px;backdrop-filter:blur(8px)">
  <div><div style="font-size:30px;font-weight:700">Teste grátis por 14 dias</div><div class="sub" style="font-size:24px;margin-top:6px">Sem cartão de crédito</div></div>
  <div class="cta" style="font-size:30px;padding:22px 34px">Começar agora →</div>
</div>
'''))

# 2) Feed 4:5 — tudo em um sistema
jobs.append(page('feed-2-completo', 1080, 1350, f'''
{logo_html()}
<h1 style="font-size:76px;margin-top:56px">Agenda, caixa, estoque e WhatsApp.<br><span class="g">Um sistema só para o seu pet shop.</span></h1>
<div style="flex:1;position:relative;margin-top:52px">
  <div class="desk" style="position:absolute;left:0;top:0;width:860px"><div class="bar"><i></i><i></i><i></i></div><img src="{T}dashboard.png" style="height:520px"></div>
  <div class="phone" style="position:absolute;right:-24px;top:90px;width:360px;height:650px"><img src="{T}m-agenda.png" style="height:622px"></div>
</div>
<div style="position:absolute;left:72px;right:72px;bottom:64px;display:flex;align-items:center;justify-content:space-between;background:rgba(9,13,22,.94);border:1.5px solid #263247;border-radius:26px;padding:26px 30px">
  <div class="price"><div class="sub" style="font-size:24px">A partir de</div><div style="font-size:44px;font-weight:800;letter-spacing:-.02em"><b>R$ 39,90</b><span class="sub" style="font-size:26px;font-weight:500">/mês</span></div></div>
  <div class="cta" style="font-size:30px;padding:22px 34px">Teste grátis 14 dias</div>
</div>
'''))

# 3) Feed 4:5 — lista de funcionalidades + preço
jobs.append(page('feed-3-funcionalidades', 1080, 1350, f'''
{logo_html()}
<div class="pill" style="font-size:26px;margin-top:56px;align-self:flex-start"><span class="dot"></span>Sistema para pet shop e banho e tosa</div>
<h1 style="font-size:70px;margin-top:30px">Tudo que o seu pet shop precisa, <span class="g">por menos de R$ 2,40 por dia.</span></h1>
<div style="margin-top:44px">{checks(["Avisa quando o cliente vai precisar de ração", "Agenda de banho e tosa com pacotes", "Caixa com Pix, cartão, dinheiro e fiado", "Estoque com sugestão de compra", "Lembretes de aniversário do pet e pós-venda", "Loja online com agendamento pela internet"], size=30, gap=20, font=31)}</div>
<div style="flex:1"></div>
<div style="display:flex;align-items:center;justify-content:space-between">
  <div class="price"><div style="font-size:52px;font-weight:800;letter-spacing:-.02em"><b>R$ 69,90</b><span class="sub" style="font-size:28px;font-weight:500">/mês no plano Profissional</span></div><div class="sub" style="font-size:24px;margin-top:6px">14 dias grátis · sem cartão · cancele quando quiser</div></div>
</div>
<div class="cta" style="font-size:34px;padding:26px;margin-top:26px">Criar conta grátis →</div>
'''))

# 4) Story 9:16 — recompra (áreas livres: 250px no topo e ~340px embaixo)
jobs.append(page('story-1-recompra', 1080, 1920, f'''
<div style="height:170px;flex-shrink:0"></div>
{logo_html()}
<h1 style="font-size:88px;margin-top:44px">Cliente que some <span class="g">compra em outro lugar.</span></h1>
<p class="sub" style="font-size:38px;margin-top:26px">O VoltaCerta lembra você de chamar cada cliente no dia certo.</p>
<div class="phone" style="width:500px;height:660px;margin:48px auto 0;flex-shrink:0"><img src="{T}m-lembretes.png" style="height:632px"></div>
<div class="cta" style="font-size:40px;padding:32px;margin-top:44px;flex-shrink:0">Teste grátis por 14 dias →</div>
''', pad=80, logo=46, mark=68))

# 5) Story 9:16 — completo
jobs.append(page('story-2-completo', 1080, 1920, f'''
<div style="height:170px;flex-shrink:0"></div>
{logo_html()}
<h1 style="font-size:88px;margin-top:44px">Agenda, caixa e estoque <span class="g">no celular.</span></h1>
<div style="margin-top:38px">{checks(["Banho e tosa sem horário duplicado", "Venda no balcão com troco e fiado", "Avisa quando o estoque está acabando"], size=36, gap=22, font=36)}</div>
<div class="phone" style="width:440px;height:560px;margin:44px auto 0;flex-shrink:0"><img src="{T}m-agenda.png" style="height:532px"></div>
<div class="cta" style="font-size:40px;padding:32px;margin-top:40px;flex-shrink:0">Começar agora →</div>
<div class="sub" style="font-size:30px;margin-top:20px;text-align:center">A partir de <b style="color:#f8fafc">R$ 39,90/mês</b> · 14 dias grátis</div>
''', pad=80, logo=46, mark=68))

# 6) Imagem de compartilhamento do site (Open Graph) 1200x630
jobs.append(page('og-image', 1200, 630, f'''
{logo_html()}
<h1 style="font-size:64px;margin-top:40px;max-width:640px">Seus clientes não precisam lembrar de voltar. <span class="g">O VoltaCerta lembra por você.</span></h1>
<p class="sub" style="font-size:26px;margin-top:22px;max-width:600px">Recompra, agenda, caixa e estoque para pet shops.</p>
<div class="phone" style="position:absolute;right:70px;top:60px;width:330px;height:640px"><img src="{T}m-recompras.png" style="height:612px"></div>
''', pad=64, logo=34, mark=52))

# 7-9) Posts orgânicos 4:5
jobs.append(page('post-1-problema', 1080, 1350, f'''
{logo_html()}
<div style="flex:1;display:flex;flex-direction:column;justify-content:center">
<h1 style="font-size:100px">A ração do seu cliente vai acabar. <span class="g">E ele vai comprar de alguém.</span></h1>
<p class="sub" style="font-size:44px;margin-top:40px">Que seja de você. Chame no dia certo, antes do supermercado.</p>
</div>
<div class="pill" style="font-size:28px;align-self:flex-start"><span class="dot"></span>Teste grátis por 14 dias · link na bio</div>
'''))

jobs.append(page('post-2-agenda', 1080, 1350, f'''
{logo_html()}
<h1 style="font-size:76px;margin-top:56px">Agenda de banho e tosa <span class="g">que não deixa marcar dois no mesmo horário.</span></h1>
<div style="flex:1;position:relative;margin-top:50px">
  <div class="desk" style="position:absolute;left:0;right:0;top:0"><div class="bar"><i></i><i></i><i></i></div><img src="{T}agenda.png" style="height:640px"></div>
</div>
'''))

jobs.append(page('post-3-estoque', 1080, 1350, f'''
{logo_html()}
<h1 style="font-size:76px;margin-top:56px">Saiba quanto pedir ao fornecedor <span class="g">antes de faltar.</span></h1>
<p class="sub" style="font-size:34px;margin-top:26px">O VoltaCerta calcula pela recompra prevista dos seus clientes e pela média de vendas.</p>
<div style="flex:1;position:relative;margin-top:50px">
  <div class="desk" style="position:absolute;left:0;right:0;top:0"><div class="bar"><i></i><i></i><i></i></div><img src="{T}estoque.png" style="height:600px"></div>
</div>
'''))

for path, w, h in jobs:
    name = os.path.splitext(os.path.basename(path))[0]
    target = os.path.abspath(os.path.join(OUT, name + '.png'))
    if name == 'og-image':
        target = os.path.abspath(os.path.join(HERE, '..', '..', 'public', 'og-image.png'))
    prof = os.path.join(os.environ.get('TEMP', HERE), 'vc-edge-art-' + name)
    if os.path.exists(target):
        os.remove(target)
    subprocess.run([EDGE, '--headless=new', '--disable-gpu', '--hide-scrollbars', f'--user-data-dir={prof}',
                    '--virtual-time-budget=6000', '--force-device-scale-factor=1', f'--window-size={w},{h}',
                    f'--screenshot={target}', 'file:///' + path.replace('\\', '/')], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    # o Edge pode terminar de gravar depois que o processo principal retorna
    for _ in range(60):
        if os.path.exists(target) and os.path.getsize(target) > 0:
            break
        time.sleep(0.5)
    time.sleep(0.5)
    print('ok' if os.path.exists(target) else 'FALHOU', name)
sys.exit(0)
