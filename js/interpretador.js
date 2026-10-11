/* TornoLab CNC · interpretador.js
   Lê o programa ISO (padrão Fanuc, sistema A de torno) e gera a lista de
   operações (movimentos, trocas, pausas, alarmes) que a simulação executa. */
window.CNC = window.CNC || {};
(function (CNC) {
  'use strict';

  const pad2 = (n) => String(Math.abs(Math.round(n))).padStart(2, '0');
  CNC.pad2 = pad2;

  /* número em pt-BR: vírgula decimal, sem zeros à direita */
  CNC.num = function (n, casas = 2) {
    if (!isFinite(n)) return '—';
    const f = Math.pow(10, casas);
    let s = (Math.round(n * f) / f).toFixed(casas);
    if (casas > 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
    if (s === '-0') s = '0';
    return s.replace('.', ',');
  };
  /* número no estilo do código G (ponto decimal) */
  const g3 = (n) => { let s = (Math.round(n * 1000) / 1000).toFixed(3).replace(/0+$/, ''); if (s.endsWith('.')) s += ''; return s; };
  CNC.g3 = g3;

  /* ---------------- Leitura de linhas ---------------- */
  const LETRAS = 'GMXZUWRIKFSTNOPQ';

  function lerLinha(raw, idx) {
    const blk = { linha: idx, raw, palavras: [], comentario: '', erros: [], vazio: false, N: null };
    let s = raw;
    const com = [];
    s = s.replace(/\([^)]*\)?/g, (m) => { com.push(m.replace(/^\(|\)$/g, '')); return ' '.repeat(m.length); });
    const sc = s.indexOf(';');
    if (sc >= 0) { com.push(s.slice(sc + 1)); s = s.slice(0, sc); }
    blk.comentario = com.join(' ').trim();
    const t = s.trim();
    if (!t || t === '%') { blk.vazio = true; return blk; }
    let i = 0;
    if (t[0] === '/') i = s.indexOf('/') + 1;
    const re = /([A-Za-z])\s*([+-]?(?:\d+\.?\d*|\.\d+))?/y;
    while (i < s.length) {
      while (i < s.length && /\s/.test(s[i])) i++;
      if (i >= s.length) break;
      re.lastIndex = i;
      const m = re.exec(s);
      if (!m) { blk.erros.push(`Caractere inválido “${s[i]}” na coluna ${i + 1}.`); break; }
      const L = m[1].toUpperCase();
      if (m[2] === undefined) { blk.erros.push(`Endereço ${L} sem valor numérico.`); i = re.lastIndex; continue; }
      if (!LETRAS.includes(L)) { blk.erros.push(`Endereço “${L}” não é usado na programação de torno.`); i = re.lastIndex; continue; }
      blk.palavras.push({ L, v: parseFloat(m[2]), raw: m[2], ponto: m[2].includes('.'), col: i });
      i = re.lastIndex;
    }
    const n = blk.palavras.find((w) => w.L === 'N');
    if (n) blk.N = Math.round(n.v);
    if (!blk.palavras.length && !blk.erros.length) blk.vazio = true;
    return blk;
  }
  CNC.lerLinha = lerLinha;

  /* valores de P/Q em ciclos: sem ponto decimal = micrômetros (regra Fanuc) */
  const micra = (w) => (w.ponto ? w.v : w.v / 1000);

  /* ---------------- Geometria do movimento ---------------- */
  CNC.comprimento = function (o) {
    if (o.arco) return o.arco.rad * Math.abs(o.arco.sw);
    return Math.hypot(o.z1 - o.z0, (o.x1 - o.x0) / 2);
  };
  CNC.pontoEm = function (o, s) {
    const L = o.len != null ? o.len : CNC.comprimento(o);
    const t = L > 0 ? Math.min(1, Math.max(0, s / L)) : 1;
    if (o.arco) {
      const a = o.arco.a0 + o.arco.sw * t;
      return { z: o.arco.cz + o.arco.rad * Math.cos(a), x: 2 * (o.arco.cr + o.arco.rad * Math.sin(a)) };
    }
    return { z: o.z0 + (o.z1 - o.z0) * t, x: o.x0 + (o.x1 - o.x0) * t };
  };

  CNC.rpm = function (st, xd) {
    if (!st || !st.fuso) return 0;
    if (st.vcc) {
      const d = Math.max(Math.abs(xd), 0.5);
      return Math.min(st.rpmMax, CNC.MAQUINA.rpmMax, (1000 * st.S) / (Math.PI * d));
    }
    return Math.min(st.S, CNC.MAQUINA.rpmMax);
  };
  /* velocidade de avanço do movimento, em mm/min */
  CNC.velocidade = function (o, xd) {
    if (o.modo === 'rapido') return CNC.MAQUINA.rapido;
    const n = CNC.rpm(o.st, xd);
    if (o.modo === 'rosca') return o.passo * n;
    return o.st.avMode === 98 ? o.F : o.F * n;
  };

  CNC.estadoInicial = function (cfg) {
    const t = (cfg && cfg.ferrInicial) || 1;
    return { mov: 0, avMode: 99, F: 0, S: 0, vcc: false, rpmMax: CNC.MAQUINA.rpmMax, g50: false,
      fuso: 0, refrig: false, ferr: t, corr: t, unid: 21, comp: 40, wcs: 54 };
  };

  CNC.estimarTempo = function (ops) {
    let t = 0;
    for (const o of ops) {
      if (o.k === 'pausa') t += o.t;
      else if (o.k === 'ferr') t += CNC.MAQUINA.tempoTroca;
      else if (o.k === 'mov') {
        const L = o.len;
        if (!(L > 0)) continue;
        if (o.modo === 'rapido') { t += (L / CNC.MAQUINA.rapido) * 60; continue; }
        const n = Math.max(1, Math.ceil(L / 2));
        for (let i = 0; i < n; i++) {
          const p = CNC.pontoEm(o, ((i + 0.5) * L) / n);
          const v = CNC.velocidade(o, p.x);
          if (v > 0) t += ((L / n) / v) * 60;
        }
      }
    }
    return t;
  };

  /* ---------------- Compilação ---------------- */
  CNC.compilar = function (texto, cfg) {
    const blocos = texto.split(/\r?\n/).map(lerLinha);
    const res = { ops: [], erros: [], avisos: [], blocos, tempo: 0, fim: false, limites: null, modalLinha: {}, numMov: 0 };
    const home = cfg.home;
    const st = Object.assign(CNC.estadoInicial(cfg), { x: home.x, z: home.z });
    const mem = { cic: null, g71: null, g72: null, g74: null, g75: null, g76: null, unicos: new Set(), vc: new Set() };
    const mapaN = {};
    blocos.forEach((b, i) => { if (b.N != null && !(b.N in mapaN)) mapaN[b.N] = i; });
    const Rb = cfg.bruta.d / 2;
    let ultimoSnap = '';
    let lim = { zmin: Infinity, zmax: -Infinity, rmin: Infinity, rmax: -Infinity };

    function ErroCNC(linha, msg) { this.cnc = true; this.linha = linha; this.msg = msg; }
    const erro = (linha, msg) => new ErroCNC(linha, msg);

    function snap() {
      return { mov: st.mov, avMode: st.avMode, F: st.F, S: st.S, vcc: st.vcc, rpmMax: st.rpmMax, g50: st.g50,
        fuso: st.fuso, refrig: st.refrig, ferr: st.ferr, corr: st.corr, unid: st.unid, comp: st.comp, wcs: st.wcs };
    }
    function op(o) { o.st = snap(); res.ops.push(o); return o; }
    function estadoSeMudou(linha) {
      const s = JSON.stringify(snap());
      if (s !== ultimoSnap) { ultimoSnap = s; op({ k: 'estado', linha }); }
    }
    function aviso(linha, msg, nivel) {
      nivel = nivel || 'aviso';
      res.avisos.push({ linha, msg, nivel });
      op({ k: 'nota', linha, msg, nivel });
    }
    function avisoUnico(chave, linha, msg, nivel) {
      if (mem.unicos.has(chave)) return;
      mem.unicos.add(chave);
      aviso(linha, msg, nivel);
    }
    function expandir(x, z) {
      const r = x / 2;
      if (z < lim.zmin) lim.zmin = z; if (z > lim.zmax) lim.zmax = z;
      if (r < lim.rmin) lim.rmin = r; if (r > lim.rmax) lim.rmax = r;
    }
    expandir(st.x, st.z);

    function verificarCorte(o) {
      if (o.modo !== 'avanco' || !st.fuso) return;
      const f = CNC.FERRAMENTAS[st.ferr];
      const m = CNC.MATERIAIS[cfg.bruta.mat];
      if (!f || !m) return;
      const faixa = f.md ? m.vcMD : m.vcHSS;
      let vc = null, chave;
      if (st.vcc) { vc = st.S; chave = `vcc-${st.ferr}-${st.S}`; }
      else if (f.tipo === 'broca') { vc = (Math.PI * f.diam * Math.min(st.S, CNC.MAQUINA.rpmMax)) / 1000; chave = `rpm-${st.ferr}-${st.S}`; }
      if (vc != null && !mem.vc.has(chave)) {
        if (vc > faixa[1] * 1.35) {
          mem.vc.add(chave);
          aviso(o.linha, `Vc ≈ ${CNC.num(vc, 0)} m/min está acima do recomendado para ${m.nome} com ${f.nome.toLowerCase()} (${faixa[0]} a ${faixa[1]} m/min). A ferramenta vai se desgastar rápido.`, 'dica');
        } else if (st.vcc && vc < faixa[0] * 0.5) {
          mem.vc.add(chave);
          aviso(o.linha, `Vc = ${CNC.num(vc, 0)} m/min está baixa para ${m.nome} (recomendado ${faixa[0]} a ${faixa[1]} m/min com metal duro).`, 'dica');
        }
      }
      if (f.f && st.avMode === 99) {
        const cf = `f-${st.ferr}-${st.F}`;
        if (!mem.vc.has(cf) && st.F > f.f[1] * 1.5) {
          mem.vc.add(cf);
          aviso(o.linha, `Avanço F${g3(st.F)} alto para ${f.nome.toLowerCase()} (recomendado ${CNC.num(f.f[0])} a ${CNC.num(f.f[1])} mm/rot).`, 'dica');
        }
      }
    }

    function mover(modo, x1, z1, linha, extra) {
      if (!isFinite(x1) || !isFinite(z1)) throw erro(linha, 'Coordenada inválida.');
      const xMax = home.x + 80, zMax = home.z + 80;
      if (x1 < CNC.MAQUINA.xMin || x1 > xMax || z1 > zMax) {
        throw erro(linha, `Sobrecurso: X${g3(x1)} Z${g3(z1)} está fora do curso da máquina (X de ${CNC.MAQUINA.xMin} a ${xMax}, Z até ${zMax}).`);
      }
      const temArco = extra && extra.arco;
      if (!temArco && Math.abs(z1 - st.z) < 1e-9 && Math.abs(x1 - st.x) < 1e-9) return null;
      if (modo === 'avanco' && !(st.F > 0)) {
        throw erro(linha, 'Avanço F não programado. Defina F antes do primeiro G01/G02/G03 (ex.: F0.2 = 0,2 mm por rotação).');
      }
      const o = { k: 'mov', modo, x0: st.x, z0: st.z, x1, z1, linha, F: st.F };
      if (extra) Object.assign(o, extra);
      o.len = CNC.comprimento(o);
      op(o);
      res.numMov++;
      verificarCorte(o);
      st.x = x1; st.z = z1;
      expandir(x1, z1);
      if (o.arco) { expandir(2 * (o.arco.cr + o.arco.rad), o.arco.cz); }
      return o;
    }

    function calcArco(x0, z0, x1, z1, horario, w, linha) {
      const s = { z: z0, r: x0 / 2 }, e = { z: z1, r: x1 / 2 };
      let c;
      const G = horario ? 'G02' : 'G03';
      if (w.R) {
        const R = w.R.v;
        const dz = e.z - s.z, dr = e.r - s.r, d = Math.hypot(dz, dr);
        if (d < 1e-6) throw erro(linha, `${G} com R e ponto final igual ao inicial: não é possível fazer círculo completo com R.`);
        if (Math.abs(R) < d / 2 - 1e-4) {
          throw erro(linha, `Raio R${w.R.raw} pequeno demais: os pontos inicial e final estão a ${CNC.num(d, 3)} mm um do outro, então o raio precisa ser de pelo menos ${CNC.num(d / 2, 3)} mm. Confira R e as coordenadas.`);
        }
        const h = Math.sqrt(Math.max(0, R * R - (d * d) / 4));
        const mz = (s.z + e.z) / 2, mr = (s.r + e.r) / 2;
        const nz = -dr / d, nr = dz / d;
        const sg = (horario ? -1 : 1) * (R > 0 ? 1 : -1);
        c = { z: mz + nz * h * sg, r: mr + nr * h * sg };
      } else if (w.I || w.K) {
        c = { z: s.z + (w.K ? w.K.v : 0), r: s.r + (w.I ? w.I.v : 0) };
        const r1 = Math.hypot(s.z - c.z, s.r - c.r), r2 = Math.hypot(e.z - c.z, e.r - c.r);
        if (Math.abs(r1 - r2) > 0.02) {
          throw erro(linha, `Ponto final fora do arco: raio no início ${CNC.num(r1, 3)} mm e no fim ${CNC.num(r2, 3)} mm. Confira I e K (I é em raio, incremental a partir do ponto inicial).`);
        }
      } else {
        throw erro(linha, `${G} precisa de R (raio) ou de I/K (centro do arco).`);
      }
      const rad = Math.hypot(s.z - c.z, s.r - c.r);
      const a0 = Math.atan2(s.r - c.r, s.z - c.z), a1 = Math.atan2(e.r - c.r, e.z - c.z);
      let sw = a1 - a0;
      if (horario) { while (sw >= -1e-9) sw -= 2 * Math.PI; while (sw < -2 * Math.PI) sw += 2 * Math.PI; }
      else { while (sw <= 1e-9) sw += 2 * Math.PI; while (sw > 2 * Math.PI) sw -= 2 * Math.PI; }
      return { cz: c.z, cr: c.r, rad, a0, sw };
    }

    function indexar(b) {
      const w = { G: [], M: [] };
      for (const p of b.palavras) {
        if (p.L === 'G') w.G.push(p);
        else if (p.L === 'M') w.M.push(p);
        else if (p.L === 'N' || p.L === 'O') w[p.L] = p;
        else {
          if (w[p.L]) throw erro(b.linha, `Endereço ${p.L} repetido no mesmo bloco.`);
          w[p.L] = p;
        }
      }
      return w;
    }
    const temEixo = (w) => !!(w.X || w.Z || w.U || w.W);
    function checarXU(w, linha) {
      if (w.X && w.U) throw erro(linha, 'X e U no mesmo bloco: use X (absoluto) ou U (incremental), não os dois.');
      if (w.Z && w.W) throw erro(linha, 'Z e W no mesmo bloco: use Z (absoluto) ou W (incremental), não os dois.');
    }
    function alvo(w) {
      return {
        x: w.X ? w.X.v : w.U ? st.x + w.U.v : st.x,
        z: w.Z ? w.Z.v : w.W ? st.z + w.W.v : st.z
      };
    }

    function trocar(wT, linha) {
      const raw = wT.raw.replace(/^[+-]/, '').split('.')[0];
      let num, cor;
      if (raw.length <= 2) {
        num = Math.round(wT.v); cor = num;
        avisoUnico('tcurto', linha, `Use o formato completo T${pad2(num)}${pad2(num)}: dois dígitos para a ferramenta e dois para o corretor.`, 'dica');
      } else {
        num = Math.floor(Math.round(wT.v) / 100); cor = Math.round(wT.v) % 100;
      }
      if (!CNC.FERRAMENTAS[num]) throw erro(linha, `A ferramenta T${pad2(num)} não existe na torre. Posições disponíveis: T01 a T08 (veja a aba Ferramentas).`);
      if (cor === 0) aviso(linha, `T${pad2(num)}00 cancela o corretor: numa máquina real a ponta ficaria fora da posição programada.`);
      else if (cor !== num) aviso(linha, `Corretor ${pad2(cor)} diferente da ferramenta ${pad2(num)}. Confira a tabela de corretores.`);
      if (st.x / 2 < Rb + 15 && st.z < cfg.bruta.face + 15) {
        aviso(linha, 'Troca de ferramenta perto da peça. Afaste a torre antes de girar (ex.: G00 X100. Z100.) para não colidir.');
      }
      st.ferr = num; st.corr = cor;
      op({ k: 'ferr', linha, ferr: num, corr: cor });
    }

    function dwell(w, linha) {
      let t = null;
      if (w.X) t = w.X.v; else if (w.U) t = w.U.v; else if (w.P) t = w.P.ponto ? w.P.v : w.P.v / 1000;
      if (!(t >= 0)) throw erro(linha, 'G04 precisa do tempo: X em segundos ou P em milissegundos (ex.: G04 X0.5).');
      if (t > 0) op({ k: 'pausa', t, linha });
    }

    function referencia(w, linha) {
      if (!temEixo(w)) throw erro(linha, 'G28 precisa dos eixos que vão à referência: use G28 U0. W0.');
      checarXU(w, linha);
      const ix = (w.X || w.U) ? (w.X ? w.X.v : st.x + w.U.v) : null;
      const iz = (w.Z || w.W) ? (w.Z ? w.Z.v : st.z + w.W.v) : null;
      if (w.X || w.Z) avisoUnico('g28abs', linha, 'G28 com X/Z absolutos passa primeiro por esse ponto intermediário. O usual é G28 U0. W0.', 'dica');
      mover('rapido', ix != null ? ix : st.x, iz != null ? iz : st.z, linha);
      mover('rapido', ix != null ? home.x : st.x, iz != null ? home.z : st.z, linha);
    }

    function movimento(g, w, linha, explicito) {
      checarXU(w, linha);
      if (g === 0 || g === 1) {
        const t = alvo(w);
        mover(g === 0 ? 'rapido' : 'avanco', t.x, t.z, linha);
      } else if (g === 2 || g === 3) {
        const t = alvo(w);
        const arco = calcArco(st.x, st.z, t.x, t.z, g === 2, w, linha);
        mover('avanco', t.x, t.z, linha, { arco });
      } else if (g === 32) {
        const t = alvo(w);
        if (!(st.F > 0)) throw erro(linha, 'G32 precisa de F = passo da rosca (ex.: F2.).');
        mover('rosca', t.x, t.z, linha, { passo: st.F, zFase: st.z });
      } else {
        cicloSimples(g, w, linha, explicito);
      }
    }

    function cicloSimples(g, w, linha, explicito) {
      const ini = { x: st.x, z: st.z };
      const ant = (!explicito && mem.cic && mem.cic.g === g) ? mem.cic : null;
      const x = w.X ? w.X.v : w.U ? ini.x + w.U.v : ant ? ant.x : null;
      const z = w.Z ? w.Z.v : w.W ? ini.z + w.W.v : ant ? ant.z : null;
      const r = w.R ? w.R.v : ant ? ant.r : 0;
      const ex = g === 94 ? 'G94 X-1.6 Z0. F0.2' : g === 92 ? 'G92 X23.2 Z-31. F2.' : 'G90 X46. Z-40. F0.25';
      if (x == null || z == null) throw erro(linha, `G${g} precisa de X (ou U) e Z (ou W). Ex.: ${ex}`);
      mem.cic = { g, x, z, r };
      if (g === 90) {
        mover('rapido', x + 2 * r, ini.z, linha);
        mover('avanco', x, z, linha);
        mover('avanco', ini.x, z, linha);
        mover('rapido', ini.x, ini.z, linha);
      } else if (g === 94) {
        mover('rapido', ini.x, z + r, linha);
        mover('avanco', x, z, linha);
        mover('avanco', x, ini.z, linha);
        mover('rapido', ini.x, ini.z, linha);
      } else {
        if (!(st.F > 0)) throw erro(linha, 'G92 precisa de F = passo da rosca (ex.: F2.).');
        mover('rapido', x + 2 * r, ini.z, linha);
        mover('rosca', x, z, linha, { passo: st.F, zFase: ini.z });
        mover('rapido', ini.x, z, linha);
        mover('rapido', ini.x, ini.z, linha);
      }
    }

    function blocosPQ(w, linha) {
      const iP = mapaN[Math.round(w.P.v)], iQ = mapaN[Math.round(w.Q.v)];
      if (iP == null) throw erro(linha, `Bloco N${w.P.raw} (início do perfil, endereço P) não foi encontrado no programa.`);
      if (iQ == null) throw erro(linha, `Bloco N${w.Q.raw} (fim do perfil, endereço Q) não foi encontrado no programa.`);
      if (iQ < iP) throw erro(linha, 'O bloco Q (fim do perfil) está antes do bloco P (início).');
      return [iP, iQ];
    }

    function lerPerfil(iP, iQ, ini, g, linhaCiclo) {
      const loc = { x: ini.x, z: ini.z, mov: st.mov };
      const els = [];
      let primeiro = true, pendF = null, pendS = null;
      for (let i = iP; i <= iQ; i++) {
        const b = blocos[i];
        if (b.erros.length) throw erro(b.linha, b.erros[0]);
        if (b.vazio) continue;
        const w = indexar(b);
        for (const gv of w.G) {
          const gg = gv.v;
          if ([0, 1, 2, 3].includes(gg)) loc.mov = gg;
          else if (![40, 41, 42].includes(gg)) throw erro(b.linha, `G${gv.raw} não pode ser usado dentro do perfil (entre os blocos P e Q).`);
        }
        if (w.M.length) throw erro(b.linha, 'Não use funções M dentro do perfil do ciclo (entre P e Q).');
        if (w.T) throw erro(b.linha, 'Não troque de ferramenta dentro do perfil do ciclo.');
        checarXU(w, b.linha);
        const tem = temEixo(w);
        if (primeiro && tem && g !== 70) {
          if (g === 71 && (w.Z || w.W)) throw erro(b.linha, 'No G71 o primeiro bloco do perfil (P) deve mover só em X (ex.: N110 G00 X16.). A entrada em Z vem no bloco seguinte.');
          if (g === 72 && (w.X || w.U)) throw erro(b.linha, 'No G72 o primeiro bloco do perfil (P) deve mover só em Z (ex.: N90 G00 Z-13.).');
        }
        if (w.F) pendF = w.F.v;
        if (w.S) pendS = w.S.v;
        if (!tem) continue;
        primeiro = false;
        const x = w.X ? w.X.v : w.U ? loc.x + w.U.v : loc.x;
        const z = w.Z ? w.Z.v : w.W ? loc.z + w.W.v : loc.z;
        if (Math.abs(x - loc.x) < 1e-9 && Math.abs(z - loc.z) < 1e-9) continue;
        const el = { modo: loc.mov === 0 ? 'rapido' : 'avanco', x0: loc.x, z0: loc.z, x1: x, z1: z, F: pendF, S: pendS, linha: b.linha };
        pendF = null; pendS = null;
        if (loc.mov === 2 || loc.mov === 3) el.arco = calcArco(loc.x, loc.z, x, z, loc.mov === 2, w, b.linha);
        els.push(el);
        loc.x = x; loc.z = z;
      }
      if (!els.length) throw erro(linhaCiclo, 'O perfil entre P e Q não tem nenhum movimento.');
      return els;
    }

    function achatar(els) {
      const pts = [];
      els.forEach((el, k) => {
        if (k === 0) { pts.push({ z: el.z1, r: el.x1 / 2, linha: el.linha }); return; }
        if (el.arco) {
          const a = el.arco;
          const n = Math.max(2, Math.ceil((Math.abs(a.sw) * a.rad) / 0.25));
          for (let i = 1; i <= n; i++) {
            const ang = a.a0 + (a.sw * i) / n;
            pts.push({ z: a.cz + a.rad * Math.cos(ang), r: a.cr + a.rad * Math.sin(ang), linha: el.linha });
          }
        } else pts.push({ z: el.z1, r: el.x1 / 2, linha: el.linha });
      });
      return pts;
    }
    function deslocar(el, U, W) {
      const n = Object.assign({}, el, { x0: el.x0 + U, x1: el.x1 + U, z0: el.z0 + W, z1: el.z1 + W });
      if (el.arco) n.arco = Object.assign({}, el.arco, { cr: el.arco.cr + U / 2, cz: el.arco.cz + W });
      return n;
    }
    function cruzamento(P, nivel, sg) {
      for (let i = 0; i < P.length; i++) {
        if (sg * (P[i].a - nivel) > 1e-6) {
          if (i === 0) return P[0].b;
          const p = P[i - 1], q = P[i];
          const t = (nivel - p.a) / (q.a - p.a);
          return p.b + Math.max(0, Math.min(1, t)) * (q.b - p.b);
        }
      }
      return P[P.length - 1].b;
    }

    function cicloDesbaste(g, w, b) {
      const linha = b.linha;
      if (!(w.P && w.Q)) {
        const prof = g === 71 ? (w.U ? w.U.v : null) : (w.W ? w.W.v : null);
        if (!(prof > 0)) {
          throw erro(linha, g === 71
            ? 'Primeira linha do G71: informe U = profundidade de corte por passe, em raio (ex.: G71 U2. R0.5).'
            : 'Primeira linha do G72: informe W = profundidade de corte por passe (ex.: G72 W2. R0.5).');
        }
        mem['g' + g] = { prof, rec: w.R ? Math.abs(w.R.v) : 0.5 };
        return null;
      }
      const par = mem['g' + g];
      if (!par) throw erro(linha, `Falta a primeira linha do G${g} (G${g} ${g === 71 ? 'U' : 'W'}__ R__) antes desta.`);
      const [iP, iQ] = blocosPQ(w, linha);
      const U = w.U ? w.U.v : 0, W = w.W ? w.W.v : 0;
      if (!(st.F > 0)) throw erro(linha, `Avanço do desbaste não definido: inclua F na segunda linha do G${g}.`);
      const ini = { x: st.x, z: st.z };
      const perfil = lerPerfil(iP, iQ, ini, g, linha);
      const pts = achatar(perfil).map((p) => ({ z: p.z + W, r: p.r + U / 2, linha: p.linha }));
      const ehG71 = g === 71;
      const A = (p) => (ehG71 ? p.r : p.z), B = (p) => (ehG71 ? p.z : p.r);
      const pt = (a, bb) => (ehG71 ? { r: a, z: bb } : { z: a, r: bb });
      const P = pts.map((p) => ({ a: A(p), b: B(p), linha: p.linha }));
      const s0 = { z: ini.z, r: ini.x / 2 };
      const a0 = A(s0), b0 = B(s0);
      if (Math.abs(P[0].a - a0) < 1e-6) throw erro(linha, `O ponto de partida do G${g} deve ficar fora do material, afastado do início do perfil.`);
      const sg = P[0].a < a0 ? 1 : -1;
      for (let i = 1; i < P.length; i++) {
        if (sg * (P[i].a - P[i - 1].a) < -0.002) {
          throw erro(P[i].linha, `Perfil com rebaixo: o G${g} (tipo I) exige que ${ehG71 ? 'X' : 'Z'} só ${sg > 0 ? 'aumente' : 'diminua'} ao longo do perfil. Bolsões não são usinados por este ciclo.`);
        }
      }
      const aLim = sg > 0 ? Math.min(...P.map((p) => p.a)) : Math.max(...P.map((p) => p.a));
      const go = (modo, p) => mover(modo, p.r * 2, p.z, linha);
      const d = par.prof, e = par.rec;
      let a = a0, ultimo = false, passes = 0;
      while (!ultimo) {
        let an = a - sg * d;
        if (sg * (an - aLim) <= 1e-6) { an = aLim; ultimo = true; }
        a = an;
        if (++passes > 400) throw erro(linha, 'Passes demais no desbaste: confira a profundidade U/W da primeira linha.');
        const bEnd = cruzamento(P, a, sg);
        if (Math.abs(bEnd - b0) < 1e-3) continue;
        const bdir = Math.sign(b0 - bEnd) || 1;
        go('rapido', pt(a, b0));
        go('avanco', pt(a, bEnd));
        go('avanco', pt(a + sg * e, bEnd + bdir * e));
        go('rapido', pt(a + sg * e, b0));
      }
      /* passe final ao longo do perfil, com o sobremetal */
      const desl = perfil.map((el) => deslocar(el, U, W));
      go('rapido', { r: desl[0].x0 / 2, z: desl[0].z0 });
      for (const el of desl) mover(el.modo, el.x1, el.z1, linha, el.arco ? { arco: el.arco } : null);
      const ult = desl[desl.length - 1];
      const fim = { r: ult.x1 / 2, z: ult.z1 };
      const af = A(fim), bf = B(fim);
      const a1 = sg > 0 ? Math.max(af, a0) : Math.min(af, a0);
      go('rapido', pt(a1, bf));
      go('rapido', pt(a1, b0));
      go('rapido', pt(a0, b0));
      return iQ + 1;
    }

    function cicloG70(w, b) {
      if (!(w.P && w.Q)) throw erro(b.linha, 'G70 precisa de P e Q: primeiro e último bloco do perfil (ex.: G70 P110 Q200).');
      const [iP, iQ] = blocosPQ(w, b.linha);
      const ini = { x: st.x, z: st.z };
      const els = lerPerfil(iP, iQ, ini, 70, b.linha);
      const Fant = st.F, Sant = st.S;
      for (const el of els) {
        if (el.F != null) st.F = el.F;
        if (el.S != null && el.S !== st.S) { st.S = el.S; op({ k: 'estado', linha: el.linha }); }
        mover(el.modo, el.x1, el.z1, el.linha, el.arco ? { arco: el.arco } : null);
        res.modalLinha[el.linha] = { mov: el.arco ? (el.arco.sw < 0 ? 2 : 3) : (el.modo === 'rapido' ? 0 : 1), avMode: st.avMode, vcc: st.vcc, perfil: true };
      }
      mover('rapido', ini.x, ini.z, b.linha);
      st.F = Fant;
      if (st.S !== Sant) st.S = Sant;
      return null;
    }

    function cicloPica(g, w, b) {
      const linha = b.linha;
      if (!temEixo(w)) { mem['g' + g] = { e: w.R ? Math.abs(w.R.v) : 0.5 }; return null; }
      checarXU(w, linha);
      let par = mem['g' + g];
      if (!par) { par = { e: 0.5 }; avisoUnico('pica' + g, linha, `Falta a primeira linha do G${g} (G${g} R__). Usando recuo de 0,5 mm.`, 'dica'); }
      if (!(st.F > 0)) throw erro(linha, `G${g} precisa de F (avanço).`);
      const ini = { x: st.x, z: st.z };
      const xT = w.X ? w.X.v : w.U ? ini.x + w.U.v : ini.x;
      const zT = w.Z ? w.Z.v : w.W ? ini.z + w.W.v : ini.z;
      const Pv = w.P ? micra(w.P) : 0, Qv = w.Q ? micra(w.Q) : 0;
      const pr = g === 75 ? 'r' : 'z', sc = g === 75 ? 'z' : 'r';
      const start = { r: ini.x / 2, z: ini.z }, target = { r: xT / 2, z: zT };
      const dPeck = g === 75 ? Pv : Qv, dShift = g === 75 ? Qv : Pv;
      const pdir = Math.sign(target[pr] - start[pr]);
      if (pdir === 0) throw erro(linha, g === 75 ? 'G75: o X final é igual ao ponto de partida.' : 'G74: o Z final é igual ao ponto de partida.');
      if (dPeck > 0 && Math.abs(target[pr] - start[pr]) / dPeck > 1500) {
        throw erro(linha, `Incremento por bicada muito pequeno (${CNC.num(dPeck, 3)} mm). Lembre: sem ponto decimal, ${g === 75 ? 'P' : 'Q'} é em micrômetros (Q8000 = 8 mm).`);
      }
      const sdir = Math.sign(target[sc] - start[sc]);
      const secs = [];
      if (sdir === 0) secs.push(start[sc]);
      else {
        if (!(dShift > 0)) throw erro(linha, `G${g}: informe ${g === 75 ? 'Q' : 'P'} (deslocamento entre penetrações, em µm) para avançar em ${sc === 'z' ? 'Z' : 'X'}.`);
        for (let s = start[sc], k = 0; ; s += sdir * dShift, k++) {
          if (sdir * (s - target[sc]) >= -1e-9 || k > 500) { secs.push(target[sc]); break; }
          secs.push(s);
        }
      }
      const p2 = (p, s) => { const o = {}; o[pr] = p; o[sc] = s; return o; };
      const go = (modo, c) => mover(modo, c.r * 2, c.z, linha);
      secs.forEach((s, k) => {
        if (k > 0) go('rapido', p2(start[pr], s));
        let cur = start[pr];
        for (;;) {
          let nxt = dPeck > 0 ? cur + pdir * dPeck : target[pr];
          if (pdir * (nxt - target[pr]) >= -1e-9) nxt = target[pr];
          go('avanco', p2(nxt, s));
          if (nxt === target[pr]) break;
          go('rapido', p2(nxt - pdir * par.e, s));
          cur = nxt;
        }
        go('rapido', p2(start[pr], s));
      });
      go('rapido', start);
      return null;
    }

    function cicloG76(w, b) {
      const linha = b.linha;
      if (!temEixo(w)) {
        let m = 1, r = 0, a = 60;
        if (w.P) {
          const s = String(Math.round(Math.abs(w.P.v))).padStart(6, '0');
          m = parseInt(s.slice(-6, -4), 10); r = parseInt(s.slice(-4, -2), 10); a = parseInt(s.slice(-2), 10);
        }
        if (![0, 29, 30, 55, 60, 80].includes(a)) throw erro(linha, `Ângulo da ferramenta ${a}° inválido no G76. Use 60 para rosca métrica (P020060).`);
        mem.g76 = { m: Math.max(1, m), r, a, dmin: w.Q ? micra(w.Q) : 0.05, d: w.R ? Math.abs(w.R.v) : 0 };
        return null;
      }
      checarXU(w, linha);
      let par = mem.g76;
      if (!par) { par = { m: 1, r: 0, a: 60, dmin: 0.05, d: 0 }; avisoUnico('g76a', linha, 'Falta a primeira linha do G76 (G76 P020060 Q100 R0.05). Usando valores padrão.', 'dica'); }
      const ini = { x: st.x, z: st.z };
      const xT = w.X ? w.X.v : w.U ? ini.x + w.U.v : null;
      const zT = w.Z ? w.Z.v : w.W ? ini.z + w.W.v : null;
      if (xT == null || zT == null) throw erro(linha, 'Segunda linha do G76: informe X (diâmetro do núcleo) e Z (fim da rosca).');
      const k = w.P ? micra(w.P) : null, dd = w.Q ? micra(w.Q) : null;
      if (!(k > 0)) throw erro(linha, 'G76: informe P = altura do filete em µm (ex.: P1227 = 1,227 mm).');
      if (!(dd > 0)) throw erro(linha, 'G76: informe Q = profundidade do 1º passe em µm (ex.: Q400 = 0,4 mm).');
      if (!(st.F > 0)) throw erro(linha, 'G76: informe F = passo da rosca (ex.: F2.).');
      if (dd > k) throw erro(linha, 'G76: o 1º passe (Q) é maior que a altura do filete (P).');
      if (k > 10) throw erro(linha, `G76: altura do filete de ${CNC.num(k, 3)} mm é grande demais. P é em µm: P1227 = 1,227 mm.`);
      const passo = st.F;
      const i = w.R ? w.R.v : 0;
      const ext = ini.x > xT;
      const sgx = ext ? 1 : -1;
      const xCrista = xT + sgx * 2 * k;
      const profs = [];
      let n = 1, prev = 0;
      for (;;) {
        let dn = dd * Math.sqrt(n);
        if (dn - prev < par.dmin) dn = prev + par.dmin;
        if (dn >= k - par.d - 1e-9 || n > 200) break;
        profs.push(dn); prev = dn; n++;
      }
      for (let j = 0; j < par.m; j++) profs.push(k);
      const tanA = Math.tan(((par.a / 2) * Math.PI) / 180);
      const zdir = Math.sign(zT - ini.z) || -1;
      for (const dep of profs) {
        const x = xCrista - sgx * 2 * dep;
        const zs = ini.z + zdir * dep * tanA;
        mover('rapido', x + 2 * i, zs, linha);
        mover('rosca', x, zT, linha, { passo, zFase: zs });
        mover('rapido', ini.x, zT, linha);
        mover('rapido', ini.x, ini.z, linha);
      }
      return null;
    }

    function ciclo(g, w, b) {
      if (g === 73) throw erro(b.linha, 'G73 (repetição de padrão) não é suportado neste simulador. Use G71 ou G72.');
      if (g === 70) return cicloG70(w, b);
      if (g === 71 || g === 72) return cicloDesbaste(g, w, b);
      if (g === 74 || g === 75) return cicloPica(g, w, b);
      return cicloG76(w, b);
    }

    function executarBloco(b) {
      const w = indexar(b);
      const linha = b.linha;
      let gMov = null, gCic = null, g04 = false, g28 = false, g50 = false;
      for (const gv of w.G) {
        const g = gv.v;
        if (!Number.isInteger(g)) throw erro(linha, `G${gv.raw} não é suportado neste simulador.`);
        switch (g) {
          case 0: case 1: case 2: case 3: case 32: case 90: case 92: case 94:
            if (gMov !== null) throw erro(linha, `G${pad2(gMov)} e G${pad2(g)} no mesmo bloco: são do mesmo grupo (movimento).`);
            gMov = g; break;
          case 4: g04 = true; break;
          case 18: break;
          case 20: st.unid = 20; avisoUnico('g20', linha, 'G20 (polegada) aceito, mas o simulador interpreta todos os valores em milímetros.'); break;
          case 21: st.unid = 21; break;
          case 28: g28 = true; break;
          case 40: st.comp = 40; break;
          case 41: case 42:
            st.comp = g;
            avisoUnico('comp', linha, 'Compensação de raio (G41/G42) aceita, mas não simulada: o desenho mostra a trajetória da ponta teórica.', 'dica');
            break;
          case 50: g50 = true; break;
          case 54: case 55: case 56: case 57: case 58: case 59: st.wcs = g; break;
          case 70: case 71: case 72: case 73: case 74: case 75: case 76:
            if (gCic !== null) throw erro(linha, 'Dois ciclos fixos no mesmo bloco.');
            gCic = g; break;
          case 96: st.vcc = true; break;
          case 97: st.vcc = false; break;
          case 98: st.avMode = 98; break;
          case 99: st.avMode = 99; break;
          case 90.1: break;
          default:
            if ([12, 13, 17, 19, 53, 65, 66, 80, 83, 84, 85, 87, 88, 89, 112, 113].includes(g)) throw erro(linha, `G${pad2(g)} existe em alguns comandos, mas não é suportado neste simulador.`);
            throw erro(linha, `G${pad2(g)} não é um código válido para torno (padrão Fanuc, sistema A). Veja a aba Códigos.`);
        }
      }
      const rosca = gMov === 32 || gMov === 92 || gCic === 76 || (gMov === null && gCic === null && (st.mov === 32 || st.mov === 92));
      if (w.F) {
        if (w.F.v < 0) throw erro(linha, 'F não pode ser negativo.');
        st.F = w.F.v;
        if (!rosca && gCic === null) {
          if (st.avMode === 99 && st.F > 1.5) aviso(linha, `F${w.F.raw} em G99 significa ${CNC.num(st.F)} mm por rotação, um avanço altíssimo. Você quis usar G98 (mm/min)?`);
          if (st.avMode === 98 && st.F < 5) aviso(linha, `F${w.F.raw} em G98 significa ${CNC.num(st.F)} mm/min, quase parado. No torno o normal é G99 (mm/rot).`);
        }
      }
      if (g50) {
        if (w.X || w.Z || w.U || w.W) throw erro(linha, 'G50 com X/Z (definir coordenadas) não é suportado. O zero-peça já está no centro da face (G54).');
        if (!w.S) throw erro(linha, 'G50 precisa de S = rotação máxima (ex.: G50 S2500).');
        st.rpmMax = Math.min(w.S.v, CNC.MAQUINA.rpmMax); st.g50 = true;
      } else if (w.S) {
        if (w.S.v < 0) throw erro(linha, 'S não pode ser negativo.');
        st.S = w.S.v;
        if (!st.vcc && st.S > CNC.MAQUINA.rpmMax) aviso(linha, `S${w.S.raw} passa do limite da máquina: a rotação fica em ${CNC.MAQUINA.rpmMax} rpm.`);
      }
      if (w.T) trocar(w.T, linha);
      const Ms = w.M.map((m) => m.v);
      for (const m of Ms) {
        if (!Number.isInteger(m)) throw erro(linha, `M${m} inválido.`);
        if (m === 3 || m === 4) {
          if (st.vcc && !st.g50) avisoUnico('g50', linha, 'G96 sem G50: a rotação fica limitada só pelo máximo da máquina (4000 rpm). Programe G50 S____ antes de ligar o eixo.');
          if (!(st.S > 0)) aviso(linha, `M0${m} com S0: o eixo-árvore não gira. Programe S junto (ex.: G96 S200 M0${m}).`);
          st.fuso = m;
          op({ k: 'estado', linha, msg: m === 3 ? 'Eixo-árvore ligado (M03, horário).' : 'Eixo-árvore ligado (M04, anti-horário).' });
        } else if (m === 8) {
          st.refrig = true; op({ k: 'estado', linha, msg: 'Refrigeração ligada (M08).' });
        } else if (m === 6) {
          aviso(linha, 'M06 não é usado no torno: a troca é feita pelo endereço T (ex.: T0202).', 'dica');
        } else if (m === 98 || m === 99) {
          throw erro(linha, 'Subprogramas (M98/M99) não são suportados neste simulador.');
        } else if (![0, 1, 2, 5, 9, 30].includes(m)) {
          throw erro(linha, `M${pad2(m)} não é reconhecido por este simulador.`);
        }
      }
      estadoSeMudou(linha);
      let prox = null;
      if (g04) dwell(w, linha);
      else if (g28) referencia(w, linha);
      else if (gCic !== null) prox = ciclo(gCic, w, b);
      else {
        if (gMov !== null) { if (gMov !== st.mov) mem.cic = null; st.mov = gMov; }
        if (temEixo(w)) movimento(st.mov, w, linha, gMov !== null);
        else if (gMov !== null && [90, 92, 94].includes(gMov)) throw erro(linha, `G${gMov} sem coordenadas.`);
      }
      for (const m of Ms) {
        if (m === 5) { st.fuso = 0; op({ k: 'estado', linha, msg: 'Eixo-árvore desligado (M05).' }); }
        else if (m === 9) { st.refrig = false; op({ k: 'estado', linha, msg: 'Refrigeração desligada (M09).' }); }
        else if (m === 0) op({ k: 'parada', opcional: false, linha, msg: 'M00: parada programada. Pressione CICLO INÍCIO para continuar.' });
        else if (m === 1) op({ k: 'parada', opcional: true, linha, msg: 'M01: parada opcional. Pressione CICLO INÍCIO para continuar.' });
        else if (m === 30 || m === 2) {
          st.fuso = 0; st.refrig = false;
          op({ k: 'fim', linha, msg: m === 30 ? 'M30: fim de programa.' : 'M02: fim de programa.' });
          return 'FIM';
        }
      }
      estadoSeMudou(linha);
      res.modalLinha[linha] = { mov: st.mov, avMode: st.avMode, vcc: st.vcc };
      return prox;
    }

    let pc = 0, guarda = 0, ultimaLinha = 0;
    try {
      while (pc < blocos.length) {
        const b = blocos[pc];
        if (++guarda > 20000) throw erro(b.linha, 'Programa longo demais.');
        if (b.erros.length) throw erro(b.linha, b.erros[0]);
        if (b.vazio) { pc++; continue; }
        ultimaLinha = b.linha;
        const r = executarBloco(b);
        if (r === 'FIM') { res.fim = true; break; }
        pc = typeof r === 'number' ? r : pc + 1;
      }
      if (!res.fim) aviso(ultimaLinha, 'O programa terminou sem M30 (ou M02).', 'dica');
    } catch (e) {
      if (!e || !e.cnc) throw e;
      res.erros.push({ linha: e.linha, msg: e.msg });
      op({ k: 'alarme', linha: e.linha, msg: e.msg, cod: 'PS' });
    }
    res.limites = lim;
    res.tempo = CNC.estimarTempo(res.ops);
    return res;
  };

  /* ---------------- Decodificador de bloco (didático) ---------------- */
  CNC.decodificar = function (texto, modal) {
    const b = lerLinha(texto, 0);
    const itens = [];
    if (b.erros.length) return { itens, erro: b.erros[0], comentario: b.comentario };
    const gs = b.palavras.filter((p) => p.L === 'G').map((p) => p.v);
    const tem = (g) => gs.includes(g);
    const ehSegunda = (g) => tem(g) && b.palavras.some((p) => p.L === 'P' || ['X', 'Z', 'U', 'W'].includes(p.L));
    const mm = (v) => CNC.num(v, 3);
    const mic = (p) => CNC.num(p.ponto ? p.v : p.v / 1000, 3);
    const mov = modal && modal.mov != null ? modal.mov : null;
    const cicloRosca = tem(32) || tem(92) || tem(76) || (!gs.length && (mov === 32 || mov === 92));
    for (const p of b.palavras) {
      const w = p.L + p.raw;
      let d = '';
      const L = p.L;
      if (L === 'N') d = 'Número do bloco (sequência). É a referência usada por P e Q nos ciclos.';
      else if (L === 'O') d = 'Número do programa.';
      else if (L === 'G' || L === 'M') {
        const cod = L + (Number.isInteger(p.v) ? pad2(p.v) : p.raw);
        const e = CNC.DIC[cod];
        d = e ? `${e.t}. ${e.d || ''}` : 'Código não reconhecido.';
      } else if (L === 'X') {
        if (tem(4)) d = `Tempo de permanência: ${mm(p.v)} s.`;
        else if (ehSegunda(76)) d = `Diâmetro do núcleo (fundo) da rosca: Ø${mm(p.v)} mm.`;
        else if (ehSegunda(75)) d = `Diâmetro do fundo do canal: Ø${mm(p.v)} mm.`;
        else if (tem(28)) d = `Ponto intermediário absoluto em X (Ø${mm(p.v)}) antes de ir à referência.`;
        else d = `Diâmetro Ø${mm(p.v)} mm (absoluto). No torno, X é sempre o diâmetro.`;
      } else if (L === 'Z') {
        if (ehSegunda(76) || tem(92) || tem(32)) d = `Fim da rosca em Z${mm(p.v)}.`;
        else if (ehSegunda(74)) d = `Profundidade final do furo: Z${mm(p.v)}.`;
        else d = `Posição Z${mm(p.v)} mm a partir da face (Z0). Negativo = em direção à placa.`;
      } else if (L === 'U') {
        if (tem(71) && !ehSegunda(71)) d = `Profundidade de corte por passe: ${mm(p.v)} mm no raio (${mm(p.v * 2)} mm no diâmetro).`;
        else if (ehSegunda(71) || ehSegunda(72)) d = `Sobremetal para o acabamento em X: ${mm(p.v)} mm no diâmetro${p.v < 0 ? ' (negativo = usinagem interna)' : ''}.`;
        else if (tem(28)) d = p.v === 0 ? 'U0: o eixo X vai direto à referência, sem ponto intermediário.' : `Ponto intermediário incremental em X: ${mm(p.v)} mm.`;
        else if (tem(4)) d = `Tempo de permanência: ${mm(p.v)} s.`;
        else d = `Deslocamento incremental em X: ${mm(p.v)} mm no diâmetro.`;
      } else if (L === 'W') {
        if (tem(72) && !ehSegunda(72)) d = `Profundidade de corte por passe em Z: ${mm(p.v)} mm.`;
        else if (ehSegunda(71) || ehSegunda(72)) d = `Sobremetal para o acabamento em Z: ${mm(p.v)} mm.`;
        else if (tem(28)) d = p.v === 0 ? 'W0: o eixo Z vai direto à referência.' : `Ponto intermediário incremental em Z: ${mm(p.v)} mm.`;
        else d = `Deslocamento incremental em Z: ${mm(p.v)} mm.`;
      } else if (L === 'R') {
        if (tem(2) || tem(3) || (!gs.length && (mov === 2 || mov === 3))) d = `Raio do arco: ${mm(Math.abs(p.v))} mm${p.v < 0 ? ' (negativo = arco maior que 180°)' : ''}.`;
        else if ((tem(71) || tem(72)) && !ehSegunda(71) && !ehSegunda(72)) d = `Recuo após cada passe: ${mm(p.v)} mm.`;
        else if ((tem(74) || tem(75)) && !ehSegunda(74) && !ehSegunda(75)) d = `Recuo entre bicadas: ${mm(p.v)} mm (quebra o cavaco).`;
        else if (tem(76) && !ehSegunda(76)) d = `Sobremetal do último passe de rosca: ${mm(p.v)} mm.`;
        else d = `Conicidade: diferença de raio entre o início e o fim do passe (${mm(p.v)} mm).`;
      } else if (L === 'I') d = `Centro do arco em X, incremental a partir do ponto inicial: ${mm(p.v)} mm no raio.`;
      else if (L === 'K') d = `Centro do arco em Z, incremental a partir do ponto inicial: ${mm(p.v)} mm.`;
      else if (L === 'F') {
        if (cicloRosca) d = `Passo da rosca: ${mm(p.v)} mm.`;
        else if (modal && modal.avMode === 98) d = `Avanço: ${mm(p.v)} mm/min (G98).`;
        else d = `Avanço: ${mm(p.v)} mm por rotação (G99).`;
      } else if (L === 'S') {
        if (tem(50)) d = `Rotação máxima permitida: ${mm(p.v)} rpm.`;
        else if (tem(96) || (!tem(97) && modal && modal.vcc)) d = `Velocidade de corte constante: ${mm(p.v)} m/min (G96).`;
        else d = `Rotação: ${mm(p.v)} rpm (G97).`;
      } else if (L === 'T') {
        const raw = p.raw.split('.')[0];
        const num = raw.length <= 2 ? Math.round(p.v) : Math.floor(Math.round(p.v) / 100);
        const cor = raw.length <= 2 ? num : Math.round(p.v) % 100;
        const f = CNC.FERRAMENTAS[num];
        d = f ? `Ferramenta ${pad2(num)} (${f.nome.toLowerCase()}) com corretor ${pad2(cor)}.` : `Ferramenta ${pad2(num)}: não existe na torre.`;
      } else if (L === 'P') {
        if (tem(70) || ehSegunda(71) || ehSegunda(72)) d = `Primeiro bloco do perfil: N${p.raw}.`;
        else if (tem(76) && !ehSegunda(76)) {
          const s = String(Math.round(Math.abs(p.v))).padStart(6, '0');
          d = `${parseInt(s.slice(-6, -4), 10)} passe(s) de acabamento, saída ${parseInt(s.slice(-4, -2), 10) / 10}×passo, ferramenta de ${parseInt(s.slice(-2), 10)}°.`;
        } else if (ehSegunda(76)) d = `Altura do filete: ${mic(p)} mm${p.ponto ? '' : ' (em µm, sem ponto decimal)'}.`;
        else if (ehSegunda(75)) d = `Penetração em X por bicada: ${mic(p)} mm no raio (µm sem ponto).`;
        else if (ehSegunda(74)) d = `Deslocamento em X entre furos: ${mic(p)} mm (µm sem ponto).`;
        else if (tem(4)) d = `Tempo de permanência: ${CNC.num(p.ponto ? p.v : p.v / 1000, 3)} s (P em milissegundos).`;
        else d = 'Parâmetro P.';
      } else if (L === 'Q') {
        if (tem(70) || ehSegunda(71) || ehSegunda(72)) d = `Último bloco do perfil: N${p.raw}.`;
        else if (tem(76) && !ehSegunda(76)) d = `Profundidade mínima de corte por passe: ${mic(p)} mm.`;
        else if (ehSegunda(76)) d = `Profundidade do 1º passe: ${mic(p)} mm (no raio).`;
        else if (ehSegunda(74)) d = `Profundidade de cada bicada: ${mic(p)} mm.`;
        else if (ehSegunda(75)) d = `Deslocamento em Z entre penetrações: ${mic(p)} mm.`;
        else d = 'Parâmetro Q.';
      }
      itens.push({ w, L, d });
    }
    let modalTxt = '';
    const temXZ = b.palavras.some((p) => ['X', 'Z', 'U', 'W'].includes(p.L));
    const gMovBloco = gs.find((g) => [0, 1, 2, 3, 32, 90, 92, 94].includes(g));
    if (temXZ && gMovBloco == null && !gs.some((g) => [4, 28, 50, 70, 71, 72, 74, 75, 76].includes(g)) && mov != null) {
      const e = CNC.DIC['G' + pad2(mov)];
      modalTxt = `Sem G de movimento: vale o último programado, G${pad2(mov)}${e ? ' (' + e.t.toLowerCase() + ')' : ''}.`;
    }
    return { itens, comentario: b.comentario, modal: modalTxt, perfil: modal && modal.perfil };
  };
})(window.CNC);
