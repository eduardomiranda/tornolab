/* TornoLab CNC · simulacao.js
   Executa as operações no tempo: movimento, remoção de material,
   colisões (placa, suporte, avanço rápido), parada e fim. */
window.CNC = window.CNC || {};
(function (CNC) {
  'use strict';
  const LIM_AREA = 0.3; // mm² de sobreposição tolerada antes de acusar colisão
  const pad2 = (n) => String(n).padStart(2, '0');

  class Simulacao {
    constructor() {
      this.ops = []; this.eventos = []; this.estado = 'vazio';
      this.blocoABloco = false; this.m01 = false; this.mat = null;
    }

    carregar(comp, cfg) {
      this.comp = comp; this.ops = comp.ops; this.cfg = cfg;
      const chave = JSON.stringify(cfg.bruta);
      if (!this.mat || this.chaveBruta !== chave) { this.mat = new CNC.Material(cfg.bruta); this.chaveBruta = chave; }
      this.placa = this.retangulosPlaca();
      this.reiniciar();
    }

    retangulosPlaca() {
      const b = this.cfg.bruta, P = CNC.PLACA, R = b.d / 2;
      const zf = -b.l, H = R + P.castanhaH, Rb = H + P.corpoFolga;
      const z1 = zf - P.castanhaL, z0 = z1 - P.corpoL;
      return [
        [[z1, -H], [zf, -H], [zf, H], [z1, H]],
        [[z0, -Rb], [z1, -Rb], [z1, Rb], [z0, Rb]]
      ];
    }

    reiniciar() {
      this.mat.reset();
      this.i = 0; this.prog = 0; this.opIniciada = false;
      this.pos = { x: this.cfg.home.x, z: this.cfg.home.z };
      this.st = CNC.estadoInicial(this.cfg);
      this.ferr = this.st.ferr; this.corr = this.st.corr;
      this.tempo = 0; this.rastro = [];
      this.estado = 'pronto'; this.motivo = ''; this.alarme = null;
      this.eventos.length = 0;
      this.removidoQuadro = 0; this.ultimoCorte = null; this.cortandoAgora = false;
    }

    evento(nivel, msg, linha) { this.eventos.push({ nivel, msg, linha, t: this.tempo }); }

    disparar(msg, linha, cod) {
      this.estado = 'alarme';
      this.alarme = { msg, linha, cod: cod || 'AL', pos: { x: this.pos.x, z: this.pos.z } };
      this.evento('alarme', msg, linha);
    }

    pausar(motivo) { this.estado = 'pausado'; this.motivo = motivo; }

    proximo() {
      const cur = this.ops[this.i];
      this.i++; this.prog = 0; this.opIniciada = false;
      const nx = this.ops[this.i];
      if (this.blocoABloco && cur && nx && nx.linha !== cur.linha && this.estado === 'rodando' && cur.k !== 'nota') this.pausar('bloco');
    }

    encerrar(o) {
      this.estado = 'fim';
      this.st = Object.assign({}, o ? o.st : this.st, { fuso: 0, refrig: false });
      this.i = this.ops.length;
    }

    opAtual() { return this.ops[Math.min(this.i, this.ops.length - 1)]; }

    /* avança dt segundos de tempo simulado */
    avancar(dt) {
      let orc = dt, n = 0;
      this.removidoQuadro = 0; this.cortandoAgora = false;
      while (this.estado === 'rodando' && orc > 1e-12 && n++ < 50000) {
        const o = this.ops[this.i];
        if (!o) { this.encerrar(null); break; }
        this.st = o.st;
        switch (o.k) {
          case 'mov': orc = this.passoMov(o, orc); break;
          case 'pausa':
          case 'ferr': {
            const T = o.k === 'ferr' ? CNC.MAQUINA.tempoTroca : o.t;
            if (!this.opIniciada) {
              this.opIniciada = true;
              if (o.k === 'ferr') {
                this.ferr = o.ferr; this.corr = o.corr;
                const f = CNC.FERRAMENTAS[o.ferr];
                this.evento('info', `Troca de ferramenta: T${pad2(o.ferr)}${pad2(o.corr)} · ${f ? f.nome : ''}.`, o.linha);
              } else this.evento('info', `Permanência de ${CNC.num(o.t, 2)} s (G04).`, o.linha);
            }
            const use = Math.min(orc, T - this.prog);
            this.prog += use; orc -= use; this.tempo += use;
            if (this.prog >= T - 1e-9) this.proximo();
            break;
          }
          case 'estado': if (o.msg) this.evento('info', o.msg, o.linha); this.proximo(); break;
          case 'nota': this.evento(o.nivel || 'aviso', o.msg, o.linha); this.proximo(); break;
          case 'parada':
            this.proximo();
            if (!o.opcional || this.m01) { this.evento('aviso', o.msg, o.linha); this.pausar(o.opcional ? 'm01' : 'm00'); }
            break;
          case 'fim': this.evento('ok', `${o.msg} Tempo de ciclo: ${CNC.formatarTempo(this.tempo)}.`, o.linha); this.encerrar(o); break;
          case 'alarme': this.disparar(o.msg, o.linha, o.cod); break;
          default: this.proximo();
        }
      }
    }

    passoMov(o, orc) {
      if (!this.opIniciada) {
        this.opIniciada = true;
        if (o.modo !== 'rapido') {
          const n = CNC.rpm(o.st, this.pos.x);
          if (n <= 0 && (o.st.avMode === 99 || o.modo === 'rosca')) {
            this.disparar(o.st.fuso
              ? 'Rotação S não programada: com S0 o avanço por rotação não anda. Programe S (ex.: G96 S200 ou G97 S800).'
              : 'Avanço com o eixo-árvore parado. Em G99 (mm/rot) o carro só anda com a placa girando: programe M03 com S antes do corte (ex.: G96 S200 M03).',
            o.linha, 'AL 2010');
            return 0;
          }
        }
      }
      const L = o.len;
      if (!(L > 1e-9)) { this.proximo(); return orc; }
      const maxPasso = o.modo === 'rapido' ? 20 : (o.arco ? 0.6 : 2.5);
      while (orc > 1e-12 && this.prog < L - 1e-9) {
        const v = CNC.velocidade(o, this.pos.x) / 60;
        if (!(v > 0)) { this.disparar('Velocidade de avanço nula: confira F, S e o eixo-árvore.', o.linha, 'AL 2011'); return 0; }
        const ds = Math.min(L - this.prog, v * orc, maxPasso);
        const s1 = this.prog + ds;
        if (!this.varrer(o, this.prog, s1)) return 0;
        const dt = ds / v;
        this.prog = s1; orc -= dt; this.tempo += dt;
        this.pos = CNC.pontoEm(o, s1);
        this.addRastro(o, this.pos);
      }
      if (this.prog >= L - 1e-9) { this.pos = { x: o.x1, z: o.z1 }; this.proximo(); }
      return orc;
    }

    addRastro(o, pos) {
      let seg = this.rastro[this.rastro.length - 1];
      if (!seg || seg.op !== o) { seg = { op: o, modo: o.modo, pts: [[o.z0, o.x0 / 2]] }; this.rastro.push(seg); }
      const p = [pos.z, pos.x / 2];
      if (!o.arco && seg.pts.length > 1) seg.pts[seg.pts.length - 1] = p; else seg.pts.push(p);
    }

    /* busca binária: maior fração f do trecho A→B sem colisão */
    buscar(A, B, teste) {
      let lo = 0, hi = 1;
      for (let k = 0; k < 14; k++) {
        const m = (lo + hi) / 2;
        if (teste(A, { z: A.z + (B.z - A.z) * m, r: A.r + (B.r - A.r) * m })) hi = m; else lo = m;
      }
      return lo;
    }

    pararEm(o, s) { this.pos = CNC.pontoEm(o, s); this.addRastro(o, this.pos); }

    varrer(o, s0, s1) {
      const f = CNC.FERRAMENTAS[this.ferr];
      if (!f) return true;
      const geo = CNC.geo, mat = this.mat;
      const pa = CNC.pontoEm(o, s0), pb = CNC.pontoEm(o, s1);
      const A = { z: pa.z, r: pa.x / 2 }, B = { z: pb.z, r: pb.x / 2 };
      const todos = f.corte.concat(f.corpo);

      const testePlaca = (P, Q) => {
        for (const poly of todos) {
          const h = geo.varrido(poly, P, Q);
          for (const rc of this.placa) if (geo.intersecta(h, rc)) return true;
        }
        return false;
      };
      if (testePlaca(A, B)) {
        const fr = this.buscar(A, B, testePlaca);
        this.pararEm(o, s0 + (s1 - s0) * fr);
        this.disparar(`Colisão com a placa: a ferramenta T${pad2(this.ferr)} atingiria as castanhas (elas começam em Z${CNC.g3(-this.cfg.bruta.l)}). Encurte o curso em Z ou aumente o balanço da peça.`, o.linha, 'AL 1020');
        return false;
      }

      if (o.modo === 'rapido') {
        const teste = (P, Q) => {
          let n = 0;
          for (const poly of todos) n += mat.contar(geo.varrido(poly, P, Q));
          return n * mat.areaCel > LIM_AREA;
        };
        if (teste(A, B)) {
          const fr = this.buscar(A, B, teste);
          this.pararEm(o, s0 + (s1 - s0) * fr);
          this.disparar('Colisão em avanço rápido: o G00 entrou no material. Use G01 (com F) para cortar, ou aproxime em G00 só até fora da peça.', o.linha, 'AL 1010');
          return false;
        }
        return true;
      }

      if (o.modo === 'rosca') {
        let rem = 0;
        const zF = o.zFase != null ? o.zFase : o.z0, P = o.passo;
        const dir = Math.sign(o.z1 - o.z0) || -1;
        const ka = Math.ceil((dir * (A.z - zF)) / P - 1e-9), kb = Math.floor((dir * (B.z - zF)) / P + 1e-9);
        for (let k = Math.max(0, ka); k <= kb; k++) {
          const z = zF + dir * k * P;
          const t = Math.abs(B.z - A.z) < 1e-12 ? 0 : (z - A.z) / (B.z - A.z);
          const r = A.r + (B.r - A.r) * t;
          for (const poly of f.corte) rem += mat.remover(geo.transladar(poly, z, r));
        }
        if (rem) { this.removidoQuadro += rem; this.ultimoCorte = B; this.cortandoAgora = true; }
        return true;
      }

      if (f.corpo.length) {
        const testeSup = (P, Q) => {
          let n = 0;
          for (const poly of f.corpo) n += mat.contar(geo.varrido(poly, P, Q));
          return n * mat.areaCel > LIM_AREA;
        };
        if (testeSup(A, B)) {
          const fr = this.buscar(A, B, testeSup);
          const sf = s0 + (s1 - s0) * fr;
          const Bf = CNC.pontoEm(o, sf);
          for (const poly of f.corte) mat.remover(geo.varrido(poly, A, { z: Bf.z, r: Bf.x / 2 }));
          this.pararEm(o, sf);
          this.disparar(`Colisão do suporte: o corpo da ferramenta T${pad2(this.ferr)} bateu na peça. Diminua a profundidade de corte ou escolha outra ferramenta para esse perfil.`, o.linha, 'AL 1030');
          return false;
        }
      }

      let rem = 0;
      for (const poly of f.corte) rem += mat.remover(geo.varrido(poly, A, B));
      if (rem) {
        if (CNC.rpm(o.st, pa.x) <= 0) {
          this.disparar('Corte com o eixo-árvore parado: a ferramenta encostou no material sem a placa girar. Ligue o eixo com M03 antes de cortar.', o.linha, 'AL 2012');
          return false;
        }
        this.removidoQuadro += rem; this.ultimoCorte = B; this.cortandoAgora = true;
        if (mat.verificarSeparacao()) this.evento('ok', 'Peça separada da barra: ela cai na bandeja.', o.linha);
      }
      return true;
    }
  }

  CNC.formatarTempo = function (s) {
    if (!isFinite(s)) return '—';
    const m = Math.floor(s / 60), r = s - m * 60;
    return `${pad2(m)}:${r < 10 ? '0' : ''}${r.toFixed(1).replace('.', ',')}`;
  };
  CNC.Simulacao = Simulacao;
})(window.CNC);
