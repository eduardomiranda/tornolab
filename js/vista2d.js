/* TornoLab CNC · vista2d.js
   Vista lateral: metade de cima em CORTE (hachurada), metade de baixo em VISTA.
   Desenha placa com castanhas girando, trajetórias, ferramenta e cavacos. */
window.CNC = window.CNC || {};
(function (CNC) {
  'use strict';

  const COR = {
    fundo: '#080b0e', grade: 'rgba(150,175,200,0.055)', gradeF: 'rgba(150,175,200,0.11)',
    texto: '#6d7987', eixo: 'rgba(244,176,0,0.8)', rapido: '#ff7246', avanco: '#38cfe0', rosca: '#ff7ab2',
    bruta: 'rgba(205,215,225,0.32)', regua: 'rgba(8,11,14,0.86)'
  };

  class Vista2D {
    constructor(canvas) {
      this.cv = canvas;
      this.ctx = canvas.getContext('2d');
      this.camada = document.createElement('canvas');
      this.cctx = this.camada.getContext('2d');
      this.view = { s: 4, z0: -20, r0: 10 };
      this.mostrar = { prevista: true, rastro: true, efeitos: true };
      this.part = [];
      this.ang = 0; this.t = 0;
      this.W = 0; this.H = 0; this.dpr = 1;
      this.prevista = null;
      this.cursor = null;
      this.aoCursor = null; this.aoDuplo = null;
      this.ligarEntrada();
    }

    tamanho() {
      const r = this.cv.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const zAntes = this.W ? this.s2w(this.W / 2, this.H / 2) : null;
      this.W = r.width; this.H = r.height; this.dpr = dpr;
      this.cv.width = Math.round(r.width * dpr); this.cv.height = Math.round(r.height * dpr);
      this.camada.width = this.cv.width; this.camada.height = this.cv.height;
      this.hachura = null;
      if (zAntes) { this.view.z0 = zAntes.z; this.view.r0 = zAntes.r; }
    }

    w2s(z, r) { return [this.W / 2 + (z - this.view.z0) * this.view.s, this.H / 2 - (r - this.view.r0) * this.view.s]; }
    s2w(X, Y) { return { z: this.view.z0 + (X - this.W / 2) / this.view.s, r: this.view.r0 - (Y - this.H / 2) / this.view.s }; }

    enquadrar(z0, z1, r0, r1) {
      if (!this.W) return;
      const mx = 46, my = 30;
      this.view.s = Math.max(0.3, Math.min((this.W - mx * 2) / (z1 - z0), (this.H - my * 2) / (r1 - r0)));
      this.view.z0 = (z0 + z1) / 2 - 10 / this.view.s;
      this.view.r0 = (r0 + r1) / 2 - 6 / this.view.s;
    }
    enquadrarPeca(b) {
      const R = b.d / 2, P = CNC.PLACA;
      this.enquadrar(-b.l - P.castanhaL - 14, (b.face || 0) + 30, -R - 8, R + 30);
    }
    enquadrarTudo(b, lim, home) {
      const R = b.d / 2, P = CNC.PLACA;
      let z0 = -b.l - P.castanhaL - P.corpoL - 4, z1 = Math.max(home.z, (b.face || 0)) + 30;
      let r0 = -R - P.castanhaH - P.corpoFolga - 4, r1 = Math.max(home.x / 2, R) + 40;
      if (lim && isFinite(lim.zmin)) { z0 = Math.min(z0, lim.zmin - 10); z1 = Math.max(z1, lim.zmax + 30); r1 = Math.max(r1, lim.rmax + 40); }
      this.enquadrar(z0, z1, r0, r1);
    }

    zoomEm(X, Y, f) {
      const a = this.s2w(X, Y);
      this.view.s = Math.max(0.3, Math.min(400, this.view.s * f));
      const b = this.s2w(X, Y);
      this.view.z0 += a.z - b.z; this.view.r0 += a.r - b.r;
    }

    ligarEntrada() {
      const cv = this.cv;
      const ptrs = new Map();
      cv.addEventListener('wheel', (e) => { e.preventDefault(); this.zoomEm(e.offsetX, e.offsetY, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
      cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.offsetX, y: e.offsetY }); cv.classList.add('arrastando'); });
      cv.addEventListener('pointermove', (e) => {
        this.cursor = this.s2w(e.offsetX, e.offsetY);
        if (this.aoCursor) this.aoCursor(this.cursor);
        const p = ptrs.get(e.pointerId);
        if (!p) return;
        if (ptrs.size === 1) {
          this.view.z0 -= (e.offsetX - p.x) / this.view.s;
          this.view.r0 += (e.offsetY - p.y) / this.view.s;
        } else if (ptrs.size === 2) {
          const outro = [...ptrs.entries()].find(([k]) => k !== e.pointerId)[1];
          const d0 = Math.hypot(p.x - outro.x, p.y - outro.y), d1 = Math.hypot(e.offsetX - outro.x, e.offsetY - outro.y);
          if (d0 > 4) this.zoomEm((e.offsetX + outro.x) / 2, (e.offsetY + outro.y) / 2, d1 / d0);
        }
        p.x = e.offsetX; p.y = e.offsetY;
      });
      const fim = (e) => { ptrs.delete(e.pointerId); if (!ptrs.size) cv.classList.remove('arrastando'); };
      cv.addEventListener('pointerup', fim);
      cv.addEventListener('pointercancel', fim);
      cv.addEventListener('pointerleave', () => { this.cursor = null; if (this.aoCursor) this.aoCursor(null); });
      cv.addEventListener('dblclick', () => { if (this.aoDuplo) this.aoDuplo(); });
    }

    definirPrevista(ops) {
      const segs = [];
      for (const o of ops) {
        if (o.k !== 'mov') continue;
        let seg = segs[segs.length - 1];
        const ini = [o.z0, o.x0 / 2];
        if (!seg || seg.modo !== o.modo || Math.abs(seg.pts[seg.pts.length - 1][0] - ini[0]) > 1e-6 || Math.abs(seg.pts[seg.pts.length - 1][1] - ini[1]) > 1e-6) {
          seg = { modo: o.modo, pts: [ini] }; segs.push(seg);
        }
        if (o.arco) {
          const n = Math.max(6, Math.ceil(Math.abs(o.arco.sw) * 18));
          for (let i = 1; i <= n; i++) { const p = CNC.pontoEm(o, (o.len * i) / n); seg.pts.push([p.z, p.x / 2]); }
        } else seg.pts.push([o.z1, o.x1 / 2]);
      }
      this.prevista = segs;
    }

    /* ---------------- partículas ---------------- */
    emitirCavacos(z, r, n, cores, sentido) {
      for (let k = 0; k < n && this.part.length < 260; k++) {
        const a = (0.35 + Math.random() * 0.9) * Math.PI;
        const v = 60 + Math.random() * 160;
        this.part.push({ tipo: 'cav', z, r, vz: Math.cos(a) * v * 0.6 + 30, vr: Math.abs(Math.sin(a)) * v * sentido, vida: 0.5 + Math.random() * 0.7,
          rot: Math.random() * 6, w: (Math.random() - 0.5) * 18, tam: 0.6 + Math.random() * 1.4, cor: cores[(Math.random() * cores.length) | 0] });
      }
    }
    emitirRefrigerante(z, r, n) {
      for (let k = 0; k < n && this.part.length < 260; k++) {
        const oz = 9 + Math.random() * 4, or = 24 + Math.random() * 4;
        const d = Math.hypot(oz, or), v = 140 + Math.random() * 60;
        this.part.push({ tipo: 'gota', z: z + oz, r: r + or, vz: (-oz / d) * v + (Math.random() - 0.5) * 20, vr: (-or / d) * v, vida: d / v * (0.8 + Math.random() * 0.4) });
      }
    }
    atualizarParticulas(dt) {
      const g = 900;
      for (const p of this.part) {
        p.vida -= dt;
        p.z += p.vz * dt; p.r += p.vr * dt;
        if (p.tipo === 'cav') { p.vr -= g * dt; p.rot += p.w * dt; }
      }
      this.part = this.part.filter((p) => p.vida > 0);
    }

    /* ---------------- desenho ---------------- */
    desenhar(sim, dt) {
      if (!this.W) return;
      this.t += dt;
      const ctx = this.ctx;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.fillStyle = COR.fundo;
      ctx.fillRect(0, 0, this.W, this.H);
      this.grade();
      const mat = sim.mat;
      if (!mat) return;
      const rpm = CNC.rpm(sim.st, sim.pos.x);
      const omega = rpm > 0 ? (0.35 + (Math.min(rpm, 3000) / 3000) * 1.6) * 2 * Math.PI : 0;
      this.ang += dt * omega * (sim.st.fuso === 4 ? -1 : 1);
      const b = sim.cfg.bruta;
      this.placa(b, false);
      this.material(mat);
      this.contornoBruta(b, mat);
      this.placa(b, true);
      this.linhaCentro();
      if (this.mostrar.prevista && this.prevista) this.caminhos(this.prevista, true);
      if (this.mostrar.rastro) this.caminhos(sim.rastro, false);
      this.marcos(sim.cfg.home);
      this.ferramenta(sim);
      this.atualizarParticulas(dt);
      if (this.mostrar.efeitos) this.desenharParticulas();
      if (sim.alarme) this.marcaAlarme(sim.alarme.pos);
      this.reguas();
      this.barraEscala();
      this.rotulos(mat);
    }

    passoGrade() {
      const passos = [0.5, 1, 2, 5, 10, 20, 50, 100, 200];
      return passos.find((v) => v * this.view.s >= 24) || 200;
    }

    grade() {
      const ctx = this.ctx, p = this.passoGrade();
      const a = this.s2w(0, 0), b = this.s2w(this.W, this.H);
      ctx.lineWidth = 1;
      const maior = (v) => Math.abs(v / (p * 5) - Math.round(v / (p * 5))) < 1e-6;
      for (let z = Math.ceil(a.z / p) * p; z <= b.z; z += p) {
        const X = Math.round(this.w2s(z, 0)[0]) + 0.5;
        ctx.strokeStyle = maior(z) ? COR.gradeF : COR.grade;
        ctx.beginPath(); ctx.moveTo(X, 0); ctx.lineTo(X, this.H); ctx.stroke();
      }
      for (let r = Math.ceil(b.r / p) * p; r <= a.r; r += p) {
        const Y = Math.round(this.w2s(0, r)[1]) + 0.5;
        ctx.strokeStyle = maior(r) ? COR.gradeF : COR.grade;
        ctx.beginPath(); ctx.moveTo(0, Y); ctx.lineTo(this.W, Y); ctx.stroke();
      }
    }

    reguas() {
      const ctx = this.ctx, p = this.passoGrade() * 5;
      const a = this.s2w(0, 0), b = this.s2w(this.W, this.H);
      ctx.fillStyle = COR.regua;
      ctx.fillRect(0, this.H - 18, this.W, 18);
      ctx.fillRect(0, 0, 40, this.H - 18);
      ctx.font = '500 10px "JetBrains Mono", monospace';
      ctx.fillStyle = COR.texto;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (let z = Math.ceil(a.z / p) * p; z <= b.z; z += p) {
        const X = this.w2s(z, 0)[0];
        if (X < 52) continue;
        ctx.fillText(String(Math.round(z * 100) / 100), X, this.H - 9);
      }
      ctx.textAlign = 'right';
      for (let r = Math.ceil(b.r / p) * p; r <= a.r; r += p) {
        const Y = this.w2s(0, r)[1];
        if (Y > this.H - 26 || Y < 8) continue;
        ctx.fillText(String(Math.abs(Math.round(r * 200) / 100)), 36, Y);
      }
      ctx.fillStyle = 'rgba(244,176,0,0.85)';
      ctx.font = '700 10px "Barlow Condensed", sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('Z', 44, this.H - 9);
      ctx.textAlign = 'center';
      ctx.fillText('ØX', 20, 10);
    }

    barraEscala() {
      const ctx = this.ctx, s = this.view.s;
      const L = [0.5, 1, 2, 5, 10, 20, 50, 100].find((v) => v * s >= 60) || 100;
      const w = L * s, x1 = this.W - 16, x0 = x1 - w, y = this.H - 30;
      ctx.strokeStyle = 'rgba(226,231,235,0.7)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x0, y - 4); ctx.lineTo(x0, y); ctx.lineTo(x1, y); ctx.lineTo(x1, y - 4); ctx.stroke();
      ctx.fillStyle = 'rgba(226,231,235,0.8)'; ctx.font = '500 10.5px "JetBrains Mono", monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText(`${CNC.num(L, 1)} mm`, (x0 + x1) / 2, y - 5);
    }

    retW(z0, r0, z1, r1) {
      const [X0, Y0] = this.w2s(z0, r1), [X1, Y1] = this.w2s(z1, r0);
      return [X0, Y0, X1 - X0, Y1 - Y0];
    }

    placa(b, frente) {
      const ctx = this.ctx, P = CNC.PLACA, R = b.d / 2;
      const zf = -b.l, z1 = zf - P.castanhaL, z0 = z1 - P.corpoL;
      const H = R + P.castanhaH, Rb = H + P.corpoFolga;
      if (!frente) {
        const [x, y, w, h] = this.retW(z0, -Rb, z1, Rb);
        const g = ctx.createLinearGradient(0, y, 0, y + h);
        g.addColorStop(0, '#1d2228'); g.addColorStop(0.25, '#3a424c'); g.addColorStop(0.5, '#4a535e'); g.addColorStop(0.75, '#353c45'); g.addColorStop(1, '#1a1f24');
        ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        for (let k = 1; k < 4; k++) { const X = x + (w * k) / 4; ctx.beginPath(); ctx.moveTo(X, y + 3); ctx.lineTo(X, y + h - 3); ctx.stroke(); }
        const [ex, ey, ew, eh] = this.retW(z1, -H, zf, H);
        ctx.setLineDash([3, 3]); ctx.strokeStyle = 'rgba(255,80,94,0.28)'; ctx.strokeRect(ex + 0.5, ey + 0.5, ew - 1, eh - 1); ctx.setLineDash([]);
      }
      const larg = P.castanhaLarg;
      for (let k = 0; k < 3; k++) {
        const phi = this.ang + (k * 2 * Math.PI) / 3;
        const c = Math.cos(phi), s = Math.sin(phi);
        if ((s > 0) !== frente) continue;
        let ymin = Infinity, ymax = -Infinity;
        for (const rho of [R, H]) for (const t of [-larg / 2, larg / 2]) { const y = rho * c - t * s; if (y < ymin) ymin = y; if (y > ymax) ymax = y; }
        const [x, y, w, h] = this.retW(z1, ymin, zf, ymax);
        const luz = frente ? 0.55 + 0.45 * s : 0.35;
        const base = Math.round(62 + 50 * luz), cor = `rgb(${base},${base + 7},${base + 16})`;
        ctx.fillStyle = cor;
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
        if (frente && h > 6) {
          ctx.strokeStyle = 'rgba(255,255,255,0.12)';
          for (let q = 1; q < 3; q++) { const X = x + (w * q) / 3; ctx.beginPath(); ctx.moveTo(X, y + 2); ctx.lineTo(X, y + h - 2); ctx.stroke(); }
        }
      }
    }

    padraoHachura() {
      if (this.hachura) return this.hachura;
      const n = Math.round(9 * this.dpr);
      const c = document.createElement('canvas'); c.width = n; c.height = n;
      const x = c.getContext('2d');
      x.strokeStyle = 'rgba(20,26,34,0.55)'; x.lineWidth = Math.max(1, this.dpr);
      x.beginPath(); x.moveTo(-1, n + 1); x.lineTo(n + 1, -1); x.stroke();
      this.hachura = this.cctx.createPattern(c, 'repeat');
      return this.hachura;
    }

    material(mat) {
      const ctx = this.ctx, c = this.cctx, d = this.dpr;
      const [X0, Y0] = this.w2s(mat.zMin, mat.rMax);
      const [X1, Yax] = this.w2s(mat.zMax, 0);
      const w = X1 - X0, h = Yax - Y0;
      const suave = this.view.s * mat.cel < 2.5;
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.globalCompositeOperation = 'source-over';
      c.clearRect(0, 0, this.camada.width, this.camada.height);
      c.imageSmoothingEnabled = suave;
      c.drawImage(mat.cvCorte, X0 * d, Y0 * d, w * d, h * d);
      c.globalCompositeOperation = 'source-in';
      const [cr, cg, cb] = mat.cor;
      const gr = c.createLinearGradient(0, Y0 * d, 0, Yax * d);
      gr.addColorStop(0, `rgb(${cr * 0.82 | 0},${cg * 0.82 | 0},${cb * 0.82 | 0})`);
      gr.addColorStop(1, `rgb(${cr * 0.68 | 0},${cg * 0.68 | 0},${cb * 0.68 | 0})`);
      c.fillStyle = gr;
      c.fillRect(X0 * d - 2, Y0 * d - 2, w * d + 4, h * d + 4);
      c.globalCompositeOperation = 'source-atop';
      c.fillStyle = this.padraoHachura();
      c.fillRect(X0 * d - 2, Y0 * d - 2, w * d + 4, h * d + 4);
      c.globalCompositeOperation = 'source-over';
      ctx.drawImage(this.camada, 0, 0, this.W, this.H);
      ctx.imageSmoothingEnabled = suave;
      ctx.drawImage(mat.cvVista, X0, Yax, w, h);
      ctx.imageSmoothingEnabled = true;
    }

    contornoBruta(b) {
      const ctx = this.ctx, R = b.d / 2, Ri = (b.furo || 0) / 2;
      const zf = b.face || 0, zl = -b.l;
      ctx.setLineDash([4, 4]); ctx.strokeStyle = COR.bruta; ctx.lineWidth = 1;
      ctx.beginPath();
      for (const sg of [1, -1]) {
        const [a0, y0] = this.w2s(zl, sg * R), [a1] = this.w2s(zf, sg * R);
        ctx.moveTo(a0, y0); ctx.lineTo(a1, y0);
        if (Ri > 0) { const [, yi] = this.w2s(zl, sg * Ri); ctx.moveTo(a0, yi); ctx.lineTo(a1, yi); }
      }
      const [xf, yt] = this.w2s(zf, R), [, yb] = this.w2s(zf, -R);
      ctx.moveTo(xf, yt); ctx.lineTo(xf, yb);
      ctx.stroke(); ctx.setLineDash([]);
    }

    linhaCentro() {
      const ctx = this.ctx, Y = Math.round(this.w2s(0, 0)[1]) + 0.5;
      ctx.strokeStyle = COR.eixo; ctx.lineWidth = 1;
      ctx.setLineDash([22, 4, 3, 4]);
      ctx.beginPath(); ctx.moveTo(40, Y); ctx.lineTo(this.W, Y); ctx.stroke();
      ctx.setLineDash([]);
    }

    caminhos(lista, prevista) {
      const ctx = this.ctx;
      const cores = { rapido: COR.rapido, avanco: COR.avanco, rosca: COR.rosca };
      for (const modo of ['rapido', 'avanco', 'rosca']) {
        ctx.beginPath();
        let algum = false;
        for (const seg of lista) {
          if (seg.modo !== modo || seg.pts.length < 2) continue;
          algum = true;
          seg.pts.forEach((p, i) => { const [X, Y] = this.w2s(p[0], p[1]); if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); });
        }
        if (!algum) continue;
        ctx.setLineDash(modo === 'rapido' ? [5, 4] : []);
        ctx.strokeStyle = cores[modo];
        ctx.globalAlpha = prevista ? 0.26 : 0.95;
        ctx.lineWidth = prevista ? 1 : 1.5;
        ctx.stroke();
      }
      ctx.globalAlpha = 1; ctx.setLineDash([]);
    }

    marcos(home) {
      const ctx = this.ctx;
      const [X, Y] = this.w2s(0, 0);
      const r = 6.5;
      ctx.fillStyle = '#080b0e'; ctx.strokeStyle = '#f4b000'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(X, Y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#f4b000';
      ctx.beginPath(); ctx.moveTo(X, Y); ctx.arc(X, Y, r, -Math.PI / 2, 0); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(X, Y); ctx.arc(X, Y, r, Math.PI / 2, Math.PI); ctx.closePath(); ctx.fill();
      ctx.font = '700 10px "Barlow Condensed", sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText('X0 Z0', X + 9, Y + 6);
      const [hx, hy] = this.w2s(home.z, home.x / 2);
      ctx.strokeStyle = 'rgba(226,231,235,0.55)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(hx, hy, 5, 0, Math.PI * 2); ctx.moveTo(hx - 8, hy); ctx.lineTo(hx + 8, hy); ctx.moveTo(hx, hy - 8); ctx.lineTo(hx, hy + 8); ctx.stroke();
      ctx.fillStyle = 'rgba(226,231,235,0.6)'; ctx.fillText('REF', hx + 8, hy + 4);
    }

    poly(pts, z, r) {
      const ctx = this.ctx;
      ctx.beginPath();
      pts.forEach((p, i) => { const [X, Y] = this.w2s(p[0] + z, p[1] + r); if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); });
      ctx.closePath();
    }

    ferramenta(sim) {
      const f = CNC.FERRAMENTAS[sim.ferr];
      if (!f) return;
      const ctx = this.ctx, z = sim.pos.z, r = sim.pos.x / 2;
      ctx.lineJoin = 'round';
      for (const c of f.corpo) {
        this.poly(c, z, r);
        ctx.fillStyle = f.tipo === 'broca' ? '#3a414b' : '#2a3139'; ctx.fill();
        ctx.strokeStyle = '#66717e'; ctx.lineWidth = 1; ctx.stroke();
      }
      for (const c of f.corte) {
        this.poly(c, z, r);
        ctx.fillStyle = f.cor; ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1; ctx.stroke();
      }
      if (f.tipo === 'broca' && this.view.s > 2) {
        ctx.save();
        this.poly(f.corte[f.corte.length - 1], z, r); ctx.clip();
        ctx.strokeStyle = 'rgba(40,48,58,0.45)'; ctx.lineWidth = 2;
        const R = f.diam / 2, passo = f.diam * 0.9;
        ctx.beginPath();
        for (let q = -2; q < 120 / passo; q++) { const [a, b] = this.w2s(z + q * passo, r - R), [c2, d2] = this.w2s(z + q * passo + passo * 0.6, r + R); ctx.moveTo(a, b); ctx.lineTo(c2, d2); }
        ctx.stroke(); ctx.restore();
      }
      const [X, Y] = this.w2s(z, r);
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(X, Y, 3.2, 0, Math.PI * 2); ctx.moveTo(X - 7, Y); ctx.lineTo(X - 4.5, Y); ctx.moveTo(X + 4.5, Y); ctx.lineTo(X + 7, Y); ctx.moveTo(X, Y - 7); ctx.lineTo(X, Y - 4.5); ctx.moveTo(X, Y + 4.5); ctx.lineTo(X, Y + 7); ctx.stroke();
    }

    desenharParticulas() {
      const ctx = this.ctx, s = this.view.s;
      for (const p of this.part) {
        const [X, Y] = this.w2s(p.z, p.r);
        if (p.tipo === 'cav') {
          const t = Math.max(2, p.tam * s * 0.9);
          ctx.strokeStyle = p.cor; ctx.lineWidth = Math.max(1, t * 0.35);
          ctx.globalAlpha = Math.min(1, p.vida * 2);
          ctx.beginPath(); ctx.arc(X, Y, t, p.rot, p.rot + 3.6); ctx.stroke();
        } else {
          ctx.strokeStyle = 'rgba(80,215,235,0.7)'; ctx.lineWidth = 1.6; ctx.globalAlpha = Math.min(1, p.vida * 6);
          ctx.beginPath(); ctx.moveTo(X, Y); ctx.lineTo(X - p.vz * 0.02 * s / 4, Y + p.vr * 0.02 * s / 4); ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    }

    marcaAlarme(pos) {
      const ctx = this.ctx, [X, Y] = this.w2s(pos.z, pos.x / 2);
      const k = (Math.sin(this.t * 6) + 1) / 2;
      ctx.strokeStyle = `rgba(255,80,94,${0.5 + 0.5 * k})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(X, Y, 12 + k * 8, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(X, Y, 26 + k * 10, 0, Math.PI * 2); ctx.globalAlpha = 0.4; ctx.stroke(); ctx.globalAlpha = 1;
    }

    rotulos(mat) {
      const ctx = this.ctx;
      const [X, Yt] = this.w2s(mat.zMax, mat.R);
      const [, Yb] = this.w2s(mat.zMax, -mat.R);
      if (Math.abs(Yb - Yt) < 50) return;
      ctx.font = '700 10px "Barlow Condensed", sans-serif';
      ctx.fillStyle = 'rgba(180,190,200,0.55)';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom'; ctx.fillText('CORTE', X + 6, Yt - 3);
      ctx.textBaseline = 'top'; ctx.fillText('VISTA', X + 6, Yb + 3);
    }
  }
  CNC.Vista2D = Vista2D;
})(window.CNC);
