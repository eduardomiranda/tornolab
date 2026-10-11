/* TornoLab CNC · app.js — liga editor, simulação, vistas e painéis. */
(function () {
  'use strict';
  const CNC = window.CNC;
  const $ = (s) => document.querySelector(s);
  const pad2 = CNC.pad2, g3 = CNC.g3;
  const VEL = [0.1, 0.25, 0.5, 1, 2, 5, 10, 25, 50, 100];
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const guardar = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* armazenamento indisponível */ } };
  const ler = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const CLS = { G: 't-g', M: 't-m', X: 't-ax', Z: 't-ax', U: 't-ax', W: 't-ax', R: 't-ar', I: 't-ar', K: 't-ar', F: 't-fs', S: 't-fs', T: 't-fs', N: 't-n', O: 't-o', P: 't-pq', Q: 't-pq' };

  const app = {
    bruta: { d: 50, l: 80, face: 1, furo: 0, mat: 'aco1045' },
    exemplo: null, comp: null, sujo: true, vel: 2, vista: '2d',
    bloco: false, m01: false, turbo: false, textoBase: '', avisouEdicao: false, acGota: 0
  };
  const sim = new CNC.Simulacao();
  const editor = new CNC.Editor($('#editor'));
  const v2d = new CNC.Vista2D($('#cv2d'));
  const v3d = new CNC.Vista3D($('#cv3d'));

  const home = () => ({ x: Math.max(120, Math.ceil((app.bruta.d + 60) / 10) * 10), z: 120 });
  const cfg = () => ({ bruta: app.bruta, home: home(), ferrInicial: 1 });

  /* ---------------- console ---------------- */
  const con = $('#console');
  const TAG = { info: 'INFO', aviso: 'AVISO', alarme: 'ALARME', dica: 'DICA', ok: 'OK' };
  function log(nivel, msg, linha, acao) {
    const el = document.createElement('div');
    el.className = 'msg msg-' + nivel;
    const t = document.createElement('span'); t.className = 'msg-t'; t.textContent = CNC.formatarTempo(sim.tempo || 0);
    const g = document.createElement('span'); g.className = 'msg-tag'; g.textContent = TAG[nivel] || 'INFO';
    const x = document.createElement('span'); x.className = 'msg-txt'; x.textContent = msg;
    el.append(t, g, x);
    if (linha != null && linha >= 0) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'msg-linha'; b.textContent = 'linha ' + (linha + 1);
      b.addEventListener('click', () => editor.irPara(linha));
      el.append(b);
    }
    if (acao) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'btn btn-sm msg-acao'; b.textContent = acao.rotulo;
      b.addEventListener('click', () => { acao.fn(); b.remove(); });
      el.append(b);
    }
    con.append(el);
    while (con.children.length > 250) con.firstChild.remove();
    con.scrollTop = con.scrollHeight;
  }

  /* ---------------- programa / simulação ---------------- */
  function preparar() {
    const c = cfg();
    const comp = CNC.compilar(editor.valor, c);
    app.comp = comp; app.sujo = false; app.turbo = false; app.avisouEdicao = false;
    sim.carregar(comp, c);
    v2d.definirPrevista(comp.ops);
    v2d.part = [];
    if (editor.erros.size) editor.marcarErros([]);
    editor.definirExec(-1);
    $('#alarme').hidden = true;
    $('#droEst').textContent = comp.erros.length ? 'com erro' : CNC.formatarTempo(comp.tempo);
    v3d.versao = -1;
    return comp;
  }

  function cicloInicio() {
    if (sim.estado === 'alarme') { log('aviso', 'Há um alarme ativo. Corrija o programa e pressione RESET antes de iniciar.'); return; }
    if (sim.estado === 'rodando') return;
    if (sim.estado === 'pausado') { sim.estado = 'rodando'; sim.motivo = ''; return; }
    if (sim.estado === 'fim' || app.sujo || !app.comp || sim.i > 0) preparar();
    sim.estado = 'rodando';
    log('info', 'CICLO INÍCIO: executando o programa.');
  }
  function parada() {
    if (sim.estado !== 'rodando') return;
    sim.pausar('hold'); app.turbo = false;
    log('aviso', 'Parada de avanço. Pressione CICLO INÍCIO para continuar.');
  }
  function reset() {
    preparar();
    log('info', 'RESET: programa no início e peça bruta restaurada.');
  }
  function irAoFim() {
    if (sim.estado === 'alarme') { log('aviso', 'Há um alarme ativo. Corrija o programa e pressione RESET.'); return; }
    if (sim.estado === 'fim' || app.sujo || !app.comp) preparar();
    if (sim.estado === 'pronto') log('info', 'Executando o programa inteiro sem animação.');
    if (sim.estado === 'pronto' || sim.estado === 'pausado') { sim.estado = 'rodando'; sim.motivo = ''; }
    app.turbo = true;
  }
  function verificar() {
    const comp = preparar();
    for (const a of comp.avisos) log(a.nivel, a.msg, a.linha);
    if (comp.erros.length) {
      const e = comp.erros[0];
      editor.marcarErros([e.linha]);
      log('alarme', `Erro de programa: ${e.msg}`, e.linha);
      editor.irPara(e.linha);
    } else {
      log('ok', `Sem erros de programação: ${comp.numMov} movimentos, tempo estimado ${CNC.formatarTempo(comp.tempo)}. Colisões só aparecem ao executar.`);
    }
  }

  function mostrarAlarme() {
    const a = sim.alarme;
    if (!a) return;
    $('#alarmeCod').textContent = a.cod === 'PS' ? 'ALARME DE PROGRAMA' : `ALARME ${String(a.cod).replace('AL ', '')}`;
    $('#alarmeLinha').textContent = `linha ${a.linha + 1} · ${editor.linha(a.linha).trim()}`;
    $('#alarmeMsg').textContent = a.msg;
    $('#alarme').hidden = false;
    editor.marcarErros([a.linha]);
    app.turbo = false;
  }

  function drenar() {
    if (!sim.eventos.length) return;
    for (const e of sim.eventos.splice(0)) {
      log(e.nivel, e.msg, e.linha);
      if (e.nivel === 'alarme') mostrarAlarme();
    }
  }

  function efeitos(dt) {
    if (!v2d.mostrar.efeitos || app.vista !== '2d') return;
    const st = sim.st, rpm = CNC.rpm(st, sim.pos.x);
    if (sim.cortandoAgora && sim.ultimoCorte && rpm > 0) {
      const m = CNC.MATERIAIS[app.bruta.mat] || CNC.MATERIAIS.aco1045;
      const n = Math.min(4, 1 + Math.floor((sim.removidoQuadro * sim.mat.areaCel) / 3));
      v2d.emitirCavacos(sim.ultimoCorte.z, sim.ultimoCorte.r, n, m.cavaco, 1);
    }
    if (st.refrig && rpm > 0) {
      const R = app.bruta.d / 2;
      if (sim.pos.x / 2 < R + 25 && sim.pos.z < (app.bruta.face || 0) + 25 && sim.pos.z > -app.bruta.l - 5) {
        app.acGota += dt * 70;
        const k = Math.floor(app.acGota); app.acGota -= k;
        v2d.emitirRefrigerante(sim.pos.z, sim.pos.x / 2, k);
      }
    }
  }

  /* ---------------- painel de estado ---------------- */
  const cache = {};
  function set(id, v) { if (cache[id] !== v) { cache[id] = v; document.getElementById(id).textContent = v; } }

  function modais(st) {
    const fuso = st.fuso === 3 ? 'M03' : st.fuso === 4 ? 'M04' : 'M05';
    const lista = [
      ['G' + pad2(st.mov), 'on'], [st.vcc ? 'G96' : 'G97', 'on'], ['G' + st.avMode, 'on'],
      ['G' + st.comp, ''], ['G' + st.unid, ''], ['G' + st.wcs, ''],
      [fuso, st.fuso ? 'ok' : ''], [st.refrig ? 'M08' : 'M09', st.refrig ? 'ciano' : ''],
      ['G50 S' + Math.round(st.rpmMax), '']
    ];
    const chave = JSON.stringify(lista);
    if (cache.modais === chave) return;
    cache.modais = chave;
    $('#modais').innerHTML = lista.map(([c, k]) => {
      const d = CNC.DIC[c.split(' ')[0]];
      return `<span class="chip ${k}" title="${d ? esc(d.t) : ''}">${esc(c)}</span>`;
    }).join('');
  }

  function painel() {
    const p = sim.pos, st = sim.st;
    set('droX', p.x.toFixed(3));
    set('droZ', p.z.toFixed(3));
    const ativo = sim.estado === 'rodando' || sim.estado === 'pausado';
    const o = ativo ? sim.ops[sim.i] : null;
    const n = CNC.rpm(st, p.x);
    let f = '—';
    if (o && o.k === 'mov' && o.modo === 'rapido' && sim.estado === 'rodando') f = `G00 ${CNC.MAQUINA.rapido} mm/min`;
    else if (o && o.k === 'mov' && o.modo === 'rosca') f = `passo ${CNC.num(o.passo, 3)} mm`;
    else if (st.F > 0) f = st.avMode === 98 ? `${CNC.num(st.F, 3)} mm/min` : `${CNC.num(st.F, 3)} mm/rot`;
    set('droF', f);
    set('droS', n > 0 ? `${Math.round(n)} rpm` : st.fuso ? '0 rpm' : 'parado');
    set('droVc', n > 0 ? `${CNC.num((Math.PI * Math.abs(p.x) * n) / 1000, 0)} m/min` : '—');
    set('droFuso', `${st.fuso === 3 ? 'M03' : st.fuso === 4 ? 'M04' : 'M05'} · ${st.refrig ? 'M08' : 'M09'}`);
    set('droTempo', CNC.formatarTempo(sim.tempo));
    set('droVol', `${CNC.num(sim.mat.volume / 1000, 1)} cm³`);
    set('droFerr', `T${pad2(sim.ferr)}${pad2(sim.corr)}`);
    const est = sim.estado === 'vazio' ? 'pronto' : sim.estado;
    const pausas = { hold: 'Parada de avanço', bloco: 'Bloco a bloco', m00: 'Parada M00', m01: 'Parada M01' };
    const txt = { pronto: 'Pronto', rodando: app.turbo ? 'Calculando…' : 'Em ciclo', alarme: 'Alarme', fim: 'Fim de programa', pausado: pausas[sim.motivo] || 'Pausado' }[est];
    if (cache.estado !== est) { cache.estado = est; $('#estadoMaquina').dataset.estado = est; }
    set('estadoTexto', txt);
    let lin = -1;
    if (ativo && o) lin = o.linha;
    else if (sim.estado === 'alarme' && sim.alarme) lin = sim.alarme.linha;
    if (!app.turbo) editor.definirExec(lin);
    set('hudBloco', lin >= 0 ? (editor.linha(lin).trim() || '—') : (sim.estado === 'fim' ? 'fim de programa' : '—'));
    modais(st);
    if (cache.ferr !== sim.ferr) {
      cache.ferr = sim.ferr;
      document.querySelectorAll('.ferr').forEach((el) => el.classList.toggle('atual', +el.dataset.num === sim.ferr));
    }
  }

  /* ---------------- laço principal ---------------- */
  let tAnt = performance.now();
  function quadro(t) {
    const dt = Math.min(0.1, Math.max(0, (t - tAnt) / 1000));
    tAnt = t;
    sim.blocoABloco = app.bloco && !app.turbo;
    sim.m01 = app.m01;
    if (sim.estado === 'rodando') {
      if (app.turbo) {
        const t0 = performance.now();
        while (sim.estado === 'rodando' && performance.now() - t0 < 28) sim.avancar(15);
        if (sim.estado !== 'rodando') app.turbo = false;
      } else {
        sim.avancar(dt * app.vel);
        efeitos(dt);
      }
      sim.mat.flush();
    }
    drenar();
    if (app.vista === '2d') v2d.desenhar(sim, dt);
    else v3d.talvez(sim.mat, app.bruta, t, false);
    painel();
    requestAnimationFrame(quadro);
  }

  /* ---------------- decodificador ---------------- */
  function decodificar(i, texto) {
    $('#decLinha').textContent = `linha ${i + 1}`;
    let modal = null;
    if (app.comp) {
      for (let k = i; k >= 0; k--) if (app.comp.modalLinha[k]) { modal = app.comp.modalLinha[k]; break; }
    }
    const r = CNC.decodificar(texto, modal);
    let h = '';
    if (r.erro) h = `<p class="erro">${esc(r.erro)}</p>`;
    else if (!r.itens.length) h = `<p class="vazio">${r.comentario ? 'Comentário: ' + esc(r.comentario) : texto.trim() === '%' ? 'Início ou fim de arquivo (%).' : 'Linha vazia. Clique numa linha do programa para ver o que cada palavra faz.'}</p>`;
    else {
      h = '<dl>' + r.itens.map((it) => `<dt class="${CLS[it.L] || ''}">${esc(it.w)}</dt><dd>${esc(it.d)}</dd>`).join('') + '</dl>';
      if (r.modal) h += `<p class="extra">${esc(r.modal)}</p>`;
      if (r.perfil) h += '<p class="extra">Bloco de perfil: executado pelo ciclo de acabamento (G70).</p>';
      if (r.comentario) h += `<p class="extra">Comentário: ${esc(r.comentario)}</p>`;
    }
    $('#decConteudo').innerHTML = h;
  }

  /* ---------------- exemplos e arquivos ---------------- */
  function atualizarProgId() {
    const m = /^\s*O(\d+)\s*(?:\(([^)]*)\))?/im.exec(editor.valor);
    set('progId', m ? `O${m[1].padStart(4, '0')}${m[2] ? ' · ' + m[2].trim() : ''}` : 'sem número de programa');
  }
  function salvarSessao() {
    guardar('tornolab.programa', editor.valor);
    guardar('tornolab.bruta', JSON.stringify(app.bruta));
    guardar('tornolab.exemplo', app.exemplo || '');
  }
  function guardarRascunho() {
    const txt = editor.valor;
    if (!txt.trim() || txt === app.textoBase) return;
    const copia = { texto: txt, bruta: Object.assign({}, app.bruta) };
    log('info', 'Seu programa anterior foi guardado.', null, {
      rotulo: 'Restaurar',
      fn: () => {
        app.exemplo = null; app.textoBase = '';
        editor.valor = copia.texto; app.bruta = copia.bruta;
        $('#selExemplo').value = 'proprio';
        $('#objetivoTexto').innerHTML = 'Programa próprio restaurado.';
        preencherBruta(); preparar(); v2d.enquadrarPeca(app.bruta); atualizarProgId(); salvarSessao();
        log('ok', 'Programa anterior restaurado.');
      }
    });
  }
  function carregarExemplo(id, guardarAtual) {
    const ex = CNC.EXEMPLOS.find((e) => e.id === id);
    if (!ex) return;
    if (guardarAtual) guardarRascunho();
    app.exemplo = ex.id; app.textoBase = ex.codigo;
    app.bruta = Object.assign({}, ex.bruta);
    editor.valor = ex.codigo;
    $('#selExemplo').value = ex.id;
    $('#objetivoTexto').innerHTML = ex.objetivo;
    preencherBruta(); montarFerramentas(); calc();
    preparar();
    v2d.enquadrarPeca(app.bruta);
    atualizarProgId(); salvarSessao();
    log('info', `Carregado: ${ex.titulo}. Pressione CICLO INÍCIO para usinar.`);
  }
  function abrirArquivo(file) {
    const fr = new FileReader();
    fr.onload = () => {
      guardarRascunho();
      const txt = String(fr.result).replace(/\r\n?/g, '\n');
      const m = /BRUTA:\s*D\s*([\d.]+)\s*X\s*([\d.]+)/i.exec(txt);
      if (m) { app.bruta = Object.assign({}, app.bruta, { d: +m[1], l: +m[2] }); }
      app.exemplo = null; app.textoBase = txt;
      editor.valor = txt;
      $('#selExemplo').value = 'proprio';
      $('#objetivoTexto').innerHTML = `Arquivo aberto: <b>${esc(file.name)}</b>.${m ? ' Peça bruta lida do comentário BRUTA.' : ' Confira a peça bruta na aba “Peça bruta”.'}`;
      preencherBruta(); preparar(); v2d.enquadrarPeca(app.bruta); atualizarProgId(); salvarSessao();
      log('ok', `Arquivo ${file.name} aberto.`);
    };
    fr.onerror = () => log('alarme', 'Não foi possível ler o arquivo.');
    fr.readAsText(file);
  }
  function baixar() {
    const m = /^\s*O(\d+)/im.exec(editor.valor);
    const nome = (m ? 'O' + m[1].padStart(4, '0') : 'programa') + '.nc';
    try {
      const url = URL.createObjectURL(new Blob([editor.valor], { type: 'text/plain' }));
      const a = document.createElement('a');
      a.href = url; a.download = nome; document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      log('ok', `Programa baixado como ${nome}. Se nada aconteceu, use Copiar.`);
    } catch (e) { log('aviso', 'Não foi possível baixar aqui. Use Copiar.'); }
  }
  function copiar() {
    const ta = $('#codigo');
    const falha = () => { ta.focus(); ta.select(); log('aviso', 'Programa selecionado no editor: use Ctrl+C para copiar.'); };
    try {
      navigator.clipboard.writeText(editor.valor).then(() => log('ok', 'Programa copiado para a área de transferência.'), falha);
    } catch (e) { falha(); }
  }

  /* ---------------- abas ---------------- */
  function desenharIcone(cv, f) {
    const dpr = Math.min(2, window.devicePixelRatio || 1), S = 58;
    cv.width = S * dpr; cv.height = S * dpr;
    const c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    let z0 = Infinity, z1 = -Infinity, r0 = Infinity, r1 = -Infinity;
    for (const p of f.corte.flat()) { z0 = Math.min(z0, p[0]); z1 = Math.max(z1, p[0]); r0 = Math.min(r0, p[1]); r1 = Math.max(r1, p[1]); }
    z1 = Math.min(z1, z0 + 30); r1 = Math.min(r1 + 8, r0 + 34);
    const k = Math.min((S - 12) / (z1 - z0), (S - 12) / (r1 - r0));
    const ox = (S - (z1 - z0) * k) / 2 - z0 * k, oy = (S + (r1 - r0) * k) / 2 + r0 * k;
    const tr = (p) => [ox + p[0] * k, oy - p[1] * k];
    const poly = (pts) => { c.beginPath(); pts.forEach((p, i) => { const [x, y] = tr(p); i ? c.lineTo(x, y) : c.moveTo(x, y); }); c.closePath(); };
    for (const p of f.corpo) { poly(p); c.fillStyle = '#2a3139'; c.fill(); c.strokeStyle = '#5e6875'; c.lineWidth = 1; c.stroke(); }
    for (const p of f.corte) { poly(p); c.fillStyle = f.cor; c.fill(); c.strokeStyle = 'rgba(0,0,0,.55)'; c.stroke(); }
    const [x, y] = tr([0, 0]);
    c.fillStyle = '#ff505e'; c.beginPath(); c.arc(x, y, 2.6, 0, Math.PI * 2); c.fill();
  }
  function montarFerramentas() {
    const m = CNC.MATERIAIS[app.bruta.mat] || CNC.MATERIAIS.aco1045;
    const box = $('#aba-ferramentas');
    box.innerHTML = '<div class="ferr-lista"></div>';
    const lista = box.firstChild;
    Object.values(CNC.FERRAMENTAS).forEach((f) => {
      const vc = f.md ? m.vcMD : m.vcHSS;
      const el = document.createElement('div');
      el.className = 'ferr' + (f.num === sim.ferr ? ' atual' : '');
      el.dataset.num = f.num;
      el.innerHTML = `<canvas aria-hidden="true"></canvas><div><h4><span>T${pad2(f.num)}${pad2(f.num)}</span>${esc(f.nome)}</h4>
        <p>${esc(f.inserto)}</p><p>${esc(f.uso)}</p>
        <p class="ferr-dados">Referência: ${esc(f.ref)}.<br>${f.f ? `f ${CNC.num(f.f[0])} a ${CNC.num(f.f[1])} mm/rot · ` : ''}Vc ${vc[0]} a ${vc[1]} m/min em ${esc(m.nome)}</p></div>`;
      lista.append(el);
      desenharIcone(el.querySelector('canvas'), f);
    });
    cache.ferr = null;
  }
  function montarCodigos() {
    const box = $('#aba-codigos');
    box.innerHTML = CNC.CODIGOS.map((g) => `<div class="cod-grupo"><h3>${esc(g.grupo)}</h3>${g.itens.map((i) => `
      <div class="cod"><code>${i.c}</code><div><h4>${esc(i.t)}</h4>${i.d ? `<p>${esc(i.d)}</p>` : ''}<pre>${esc(i.ex)}</pre></div>
      <button class="btn" type="button" data-ex="${esc(i.ex)}" title="Inserir depois da linha do cursor">Inserir</button></div>`).join('')}</div>`).join('');
    box.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-ex]');
      if (!b) return;
      editor.inserir(b.dataset.ex);
      log('info', `Modelo inserido no programa: ${b.dataset.ex.split('\n')[0]}. Ajuste os valores.`);
    });
  }
  function preencherBruta() {
    $('#bD').value = app.bruta.d; $('#bL').value = app.bruta.l; $('#bF').value = app.bruta.face;
    $('#bFuro').value = app.bruta.furo || 0; $('#bMat').value = app.bruta.mat;
    $('#notaPlaca').textContent = 'Z' + g3(-app.bruta.l);
    $('#brutaErro').hidden = true;
  }
  function aplicarBruta(e) {
    e.preventDefault();
    const d = +$('#bD').value, l = +$('#bL').value, face = +$('#bF').value, furo = +$('#bFuro').value, mat = $('#bMat').value;
    let erro = '';
    if (!(d >= 6 && d <= 160)) erro = 'O diâmetro deve ficar entre 6 e 160 mm.';
    else if (!(l >= 5 && l <= 200)) erro = 'O balanço deve ficar entre 5 e 200 mm.';
    else if (!(face >= 0 && face <= 10)) erro = 'O sobremetal na face deve ficar entre 0 e 10 mm.';
    else if (!(furo >= 0 && furo <= d - 4)) erro = 'O furo prévio deve ser pelo menos 4 mm menor que o diâmetro.';
    if (erro) { $('#brutaErro').textContent = erro; $('#brutaErro').hidden = false; return; }
    app.bruta = { d, l, face, furo, mat };
    preencherBruta(); montarFerramentas(); calc();
    preparar(); v2d.enquadrarPeca(app.bruta); salvarSessao();
    log('ok', `Peça bruta: Ø${CNC.num(d)} × ${CNC.num(l)} mm em balanço, ${CNC.MATERIAIS[mat].nome}. Simulação reiniciada.`);
  }
  function calc() {
    const v = (id) => parseFloat($(id).value);
    const vc = v('#cVc'), d = v('#cD');
    const n = vc > 0 && d > 0 ? (1000 * vc) / (Math.PI * d) : NaN;
    $('#cN').textContent = isFinite(n) ? Math.round(n) : '—';
    const m = CNC.MATERIAIS[app.bruta.mat] || CNC.MATERIAIS.aco1045;
    $('#cRec').textContent = `${m.nome}: Vc ${m.vcMD[0]} a ${m.vcMD[1]} m/min com metal duro, ${m.vcHSS[0]} a ${m.vcHSS[1]} m/min com aço rápido.`;
    const f = v('#cF'), n2 = v('#cN2'), L = v('#cL');
    const vf = f * n2;
    $('#cVf').textContent = vf > 0 ? CNC.num(vf, 1) : '—';
    $('#cT').textContent = vf > 0 && L >= 0 ? (L / vf * 60 < 120 ? `${CNC.num((L / vf) * 60, 1)} s` : `${CNC.num(L / vf, 2)} min`) : '—';
    const rf = v('#cRf'), re = v('#cRe');
    const rt = rf > 0 && re > 0 ? ((rf * rf) / (8 * re)) * 1000 : NaN;
    $('#cRt').textContent = isFinite(rt) ? CNC.num(rt, 2) : '—';
    $('#cRa').textContent = isFinite(rt) ? CNC.num(rt / 4, 2) : '—';
    const D = v('#cRD'), P = v('#cRP');
    const h = 0.6134 * P, d3 = D - 2 * h;
    $('#cRh').textContent = P > 0 ? CNC.num(h, 3) : '—';
    $('#cRd3').textContent = P > 0 && D > 0 ? CNC.num(d3, 3) : '—';
  }
  function inserirRosca() {
    const D = parseFloat($('#cRD').value), P = parseFloat($('#cRP').value);
    if (!(D > 0 && P > 0)) { log('aviso', 'Informe o diâmetro nominal e o passo da rosca.'); return; }
    const h = 0.6134 * P, d3 = D - 2 * h;
    const q = Math.round(Math.min(0.4, Math.max(0.1, h / 3)) * 1000);
    const txt = `(ROSCA M${CNC.num(D)}X${CNC.num(P)} - AJUSTE O Z FINAL)\nG97 S600 M03\nG00 X${g3(D + 4)} Z${g3(Math.max(3, P * 3))}\nG76 P020060 Q100 R0.05\nG76 X${g3(Math.round(d3 * 1000) / 1000)} Z-20. P${Math.round(h * 1000)} Q${q} F${g3(P)}`;
    editor.inserir(txt);
    log('info', `Ciclo G76 para M${CNC.num(D)}×${CNC.num(P)} inserido. Ajuste o Z final e a ferramenta (T0404).`);
  }

  function abas(nome) {
    document.querySelectorAll('.seg-abas button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.aba === nome)));
    document.querySelectorAll('.aba').forEach((a) => { a.hidden = a.id !== 'aba-' + nome; });
    guardar('tornolab.aba', nome);
  }
  function definirVista(v) {
    app.vista = v;
    $('#tab2d').setAttribute('aria-selected', String(v === '2d'));
    $('#tab3d').setAttribute('aria-selected', String(v === '3d'));
    $('#cv2d').hidden = v !== '2d'; $('#cv3d').hidden = v !== '3d';
    $('#opcoes2d').hidden = v !== '2d'; $('#zoom2d').hidden = v !== '2d';
    $('#hudLegenda').hidden = v !== '2d'; $('#dica3d').hidden = v !== '3d';
    $('#hudCursor').hidden = true;
    if (v === '3d') { v3d.tamanho(); v3d.talvez(sim.mat, app.bruta, performance.now(), true); }
    else v2d.tamanho();
  }

  /* ---------------- início ---------------- */
  function iniciar() {
    const sel = $('#selExemplo');
    sel.innerHTML = '<option value="proprio">Programa próprio</option>' + CNC.EXEMPLOS.map((e) => `<option value="${e.id}">${esc(e.titulo)}</option>`).join('');
    sel.addEventListener('change', () => { if (sel.value !== 'proprio') carregarExemplo(sel.value, true); });
    $('#bMat').innerHTML = Object.entries(CNC.MATERIAIS).map(([k, m]) => `<option value="${k}">${esc(m.nome)}</option>`).join('');
    montarCodigos();

    editor.aoCursor = decodificar;
    editor.aoMudar = () => {
      app.sujo = true;
      if (editor.erros.size && sim.estado !== 'alarme') editor.marcarErros([]);
      clearTimeout(app.tSalvar); app.tSalvar = setTimeout(salvarSessao, 400);
      atualizarProgId();
      if (sim.estado === 'pronto') {
        clearTimeout(app.tPrev);
        app.tPrev = setTimeout(() => { if (sim.estado === 'pronto') preparar(); }, 450);
      } else if ((sim.estado === 'rodando' || sim.estado === 'pausado') && !app.avisouEdicao) {
        app.avisouEdicao = true;
        log('dica', 'Programa alterado durante a execução. A máquina continua com a versão anterior: pressione RESET para usar a nova.');
      }
    };

    $('#btnStart').addEventListener('click', cicloInicio);
    $('#btnHold').addEventListener('click', parada);
    $('#btnReset').addEventListener('click', reset);
    $('#btnFim').addEventListener('click', irAoFim);
    $('#btnVerificar').addEventListener('click', verificar);
    $('#btnNovo').addEventListener('click', () => carregarExemplo('modelo', true));
    $('#btnAbrir').addEventListener('click', () => $('#arquivo').click());
    $('#arquivo').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) abrirArquivo(f); e.target.value = ''; });
    if ($('#btnSalvar')) $('#btnSalvar').addEventListener('click', baixar);
    $('#btnCopiar').addEventListener('click', copiar);
    $('#alarmeIr').addEventListener('click', () => { if (sim.alarme) editor.irPara(sim.alarme.linha); });
    const chave = (id, prop) => {
      const b = $(id);
      b.addEventListener('click', () => { app[prop] = !app[prop]; b.setAttribute('aria-pressed', String(app[prop])); });
    };
    chave('#btnBloco', 'bloco'); chave('#btnM01', 'm01');
    const vel = $('#velocidade');
    const aplicarVel = () => { app.vel = VEL[+vel.value]; $('#velTxt').textContent = '×' + CNC.num(app.vel, 2); guardar('tornolab.vel', vel.value); };
    const vSalva = ler('tornolab.vel');
    if (vSalva != null && VEL[+vSalva] != null) vel.value = vSalva;
    vel.addEventListener('input', aplicarVel); aplicarVel();

    $('#tab2d').addEventListener('click', () => definirVista('2d'));
    $('#tab3d').addEventListener('click', () => definirVista('3d'));
    $('#optPrevista').addEventListener('change', (e) => { v2d.mostrar.prevista = e.target.checked; });
    $('#optRastro').addEventListener('change', (e) => { v2d.mostrar.rastro = e.target.checked; });
    const reduz = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduz) { $('#optEfeitos').checked = false; v2d.mostrar.efeitos = false; }
    $('#optEfeitos').addEventListener('change', (e) => { v2d.mostrar.efeitos = e.target.checked; if (!e.target.checked) v2d.part = []; });
    $('#btnFitPeca').addEventListener('click', () => v2d.enquadrarPeca(app.bruta));
    $('#btnFitTudo').addEventListener('click', () => v2d.enquadrarTudo(app.bruta, app.comp && app.comp.limites, home()));
    v2d.aoDuplo = () => v2d.enquadrarPeca(app.bruta);
    v2d.aoCursor = (w) => {
      const el = $('#hudCursor');
      if (!w || app.vista !== '2d') { el.hidden = true; return; }
      el.hidden = false;
      el.textContent = `cursor  X Ø${(Math.abs(w.r) * 2).toFixed(2)}  Z ${w.z.toFixed(2)}`;
    };

    document.querySelectorAll('.seg-abas button').forEach((b) => b.addEventListener('click', () => abas(b.dataset.aba)));
    $('#formBruta').addEventListener('submit', aplicarBruta);
    document.querySelectorAll('#aba-calc input').forEach((i) => i.addEventListener('input', calc));
    $('#cRIns').addEventListener('click', inserirRosca);

    const modal = $('#modalAjuda');
    const abrirAjuda = () => { modal.hidden = false; $('#ajudaFechar').focus(); };
    const fecharAjuda = () => { modal.hidden = true; $('#btnAjuda').focus(); };
    $('#btnAjuda').addEventListener('click', abrirAjuda);
    $('#ajudaFechar').addEventListener('click', fecharAjuda);
    modal.addEventListener('click', (e) => { if (e.target === modal) fecharAjuda(); });
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); cicloInicio(); }
      else if (e.key === 'Escape') { if (!modal.hidden) fecharAjuda(); else parada(); }
    });

    const ro = new ResizeObserver(() => {
      const primeira = !v2d.W;
      v2d.tamanho();
      if (primeira && v2d.W) v2d.enquadrarPeca(app.bruta);
      if (app.vista === '3d') v3d.tamanho();
    });
    ro.observe($('#viewport'));

    const salvo = ler('tornolab.programa');
    if (salvo && salvo.trim()) {
      try { const b = JSON.parse(ler('tornolab.bruta') || 'null'); if (b && b.d > 0 && b.l > 0) app.bruta = Object.assign({ face: 0, furo: 0, mat: 'aco1045' }, b); } catch (e) { /* ignora */ }
      const ex = CNC.EXEMPLOS.find((e) => e.id === ler('tornolab.exemplo'));
      app.exemplo = ex ? ex.id : null;
      app.textoBase = ex ? ex.codigo : salvo;
      editor.valor = salvo;
      sel.value = ex ? ex.id : 'proprio';
      $('#objetivoTexto').innerHTML = ex ? ex.objetivo + (ex.codigo !== salvo ? '<p><i>Versão modificada por você.</i></p>' : '') : 'Programa próprio da última sessão.';
      preencherBruta(); montarFerramentas(); calc(); preparar(); atualizarProgId();
      log('info', 'Programa da última sessão restaurado. Escolha um exemplo na lista para começar outro.');
    } else {
      carregarExemplo('ex03', false);
      log('dica', 'Primeira vez? Clique em “Como usar”. Atalhos: Ctrl+Enter inicia o ciclo, Esc para o avanço.');
    }
    const aba = ler('tornolab.aba');
    if (aba && document.getElementById('aba-' + aba)) abas(aba);
    requestAnimationFrame((t) => { tAnt = t; requestAnimationFrame(quadro); });
  }

  iniciar();
})();
