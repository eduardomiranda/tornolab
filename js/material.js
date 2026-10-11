/* TornoLab CNC · material.js
   Peça bruta como grade de células no meio-corte (z × r).
   Remove material varrendo o polígono da ferramenta e gera as imagens
   do corte (máscara) e da vista externa sombreada. */
window.CNC = window.CNC || {};
(function (CNC) {
  'use strict';

  const geo = {
    transladar(poly, dz, dr) { return poly.map((p) => [p[0] + dz, p[1] + dr]); },
    envoltoria(pts) {
      const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      if (p.length < 3) return p;
      const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
      const lo = [];
      for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
      const up = [];
      for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
      up.pop(); lo.pop();
      return lo.concat(up);
    },
    /* área varrida por um polígono convexo transladado de a até b (exata para retas) */
    varrido(poly, a, b) {
      if (Math.abs(a.z - b.z) < 1e-9 && Math.abs(a.r - b.r) < 1e-9) return geo.transladar(poly, a.z, a.r);
      return geo.envoltoria(geo.transladar(poly, a.z, a.r).concat(geo.transladar(poly, b.z, b.r)));
    },
    /* teste de separação de eixos (polígonos convexos) */
    intersecta(A, B) {
      for (const P of [A, B]) {
        for (let i = 0; i < P.length; i++) {
          const p = P[i], q = P[(i + 1) % P.length];
          const nx = -(q[1] - p[1]), ny = q[0] - p[0];
          if (nx === 0 && ny === 0) continue;
          let amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity;
          for (const v of A) { const d = v[0] * nx + v[1] * ny; if (d < amin) amin = d; if (d > amax) amax = d; }
          for (const v of B) { const d = v[0] * nx + v[1] * ny; if (d < bmin) bmin = d; if (d > bmax) bmax = d; }
          if (amax <= bmin + 1e-9 || bmax <= amin + 1e-9) return false;
        }
      }
      return true;
    }
  };
  CNC.geo = geo;

  class Material {
    constructor(bruta) {
      this.b = Object.assign({}, bruta);
      const P = CNC.PLACA;
      this.R = bruta.d / 2;
      this.Ri = Math.max(0, (bruta.furo || 0) / 2);
      const zMax = bruta.face || 0;
      const comp = zMax - (-bruta.l - P.castanhaL);
      const cands = [0.05, 0.075, 0.1, 0.125, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5];
      this.cel = cands.find((c) => (comp / c) * (this.R / c) <= 650000) || 0.5;
      this.nz = Math.ceil(comp / this.cel - 1e-9);
      this.nr = Math.ceil(this.R / this.cel - 1e-9);
      this.zMax = zMax;
      this.zMin = zMax - this.nz * this.cel;
      this.rMax = this.nr * this.cel;
      this.areaCel = this.cel * this.cel;
      this.grid = new Uint8Array(this.nz * this.nr);
      this.cont = new Int32Array(this.nz);
      this.topo = new Int32Array(this.nz);
      this.colSuja = new Uint8Array(this.nz);
      this.listaSuja = [];
      this.cor = (CNC.MATERIAIS[bruta.mat] || CNC.MATERIAIS.aco1045).cor;
      this.versao = 0;
      this.temCanvas = typeof document !== 'undefined';
      if (this.temCanvas) {
        const mk = () => { const c = document.createElement('canvas'); c.width = this.nz; c.height = this.nr; return c; };
        this.cvCorte = mk(); this.cvVista = mk();
        this.ctxCorte = this.cvCorte.getContext('2d');
        this.ctxVista = this.cvVista.getContext('2d');
        this.imgCorte = this.ctxCorte.createImageData(this.nz, this.nr);
        this.imgVista = this.ctxVista.createImageData(this.nz, this.nr);
        this.pxCorte = new Uint32Array(this.imgCorte.data.buffer);
        this.pxVista = new Uint32Array(this.imgVista.data.buffer);
      }
      this.reset();
    }

    reset() {
      const { nz, nr, cel, R, Ri, grid } = this;
      grid.fill(0);
      for (let j = 0; j < nr; j++) {
        const rc = (j + 0.5) * cel;
        if (rc < R && rc >= Ri) grid.fill(1, j * nz, (j + 1) * nz);
      }
      for (let i = 0; i < nz; i++) {
        let c = 0, top = 0;
        for (let j = 0; j < nr; j++) if (grid[j * nz + i]) { c++; top = j + 1; }
        this.cont[i] = c; this.topo[i] = top;
      }
      this.colSuja.fill(0); this.listaSuja.length = 0;
      this.volume = 0; this.versao++; this.temZero = false; this.dr = null;
      if (this.temCanvas) {
        for (let j = 0; j < nr; j++) {
          const row = (nr - 1 - j) * nz, base = j * nz;
          for (let i = 0; i < nz; i++) this.pxCorte[row + i] = grid[base + i] ? 0xffffffff : 0;
        }
        for (let i = 0; i < nz; i++) this.pintarColVista(i);
        this.ctxCorte.putImageData(this.imgCorte, 0, 0);
        this.ctxVista.putImageData(this.imgVista, 0, 0);
      }
    }

    bboxToca(poly) {
      let zmin = Infinity, zmax = -Infinity, rmax = -Infinity;
      for (const p of poly) { if (p[0] < zmin) zmin = p[0]; if (p[0] > zmax) zmax = p[0]; if (p[1] > rmax) rmax = p[1]; }
      return zmax >= this.zMin && zmin <= this.zMax && rmax >= 0;
    }

    _spans(poly, cb) {
      const { cel, nz, nr, zMin } = this;
      let rmin = Infinity, rmax = -Infinity;
      for (const p of poly) { if (p[1] < rmin) rmin = p[1]; if (p[1] > rmax) rmax = p[1]; }
      const j0 = Math.max(0, Math.ceil(rmin / cel - 0.5));
      const j1 = Math.min(nr - 1, Math.floor(rmax / cel - 0.5));
      const n = poly.length;
      for (let j = j0; j <= j1; j++) {
        const rc = (j + 0.5) * cel;
        let zl = Infinity, zr = -Infinity;
        for (let k = 0; k < n; k++) {
          const a = poly[k], b = poly[(k + 1) % n];
          const ar = a[1], br = b[1];
          if ((ar <= rc && br >= rc) || (br <= rc && ar >= rc)) {
            if (ar === br) {
              if (a[0] < zl) zl = a[0]; if (b[0] < zl) zl = b[0];
              if (a[0] > zr) zr = a[0]; if (b[0] > zr) zr = b[0];
            } else {
              const z = a[0] + ((rc - ar) / (br - ar)) * (b[0] - a[0]);
              if (z < zl) zl = z; if (z > zr) zr = z;
            }
          }
        }
        if (zl > zr) continue;
        const i0 = Math.max(0, Math.ceil((zl - zMin) / cel - 0.5));
        const i1 = Math.min(nz - 1, Math.floor((zr - zMin) / cel - 0.5));
        if (i0 <= i1) cb(j, i0, i1);
      }
    }

    contar(poly) {
      if (!this.bboxToca(poly)) return 0;
      let n = 0;
      const { grid, nz } = this;
      this._spans(poly, (j, i0, i1) => { const base = j * nz; for (let i = i0; i <= i1; i++) n += grid[base + i]; });
      return n;
    }

    remover(poly) {
      if (!this.bboxToca(poly)) return 0;
      let n = 0, soma = 0;
      const { grid, nz, nr } = this;
      const px = this.temCanvas ? this.pxCorte : null;
      this._spans(poly, (j, i0, i1) => {
        const base = j * nz, row = (nr - 1 - j) * nz;
        let rem = 0, a = -1, b = -1;
        for (let i = i0; i <= i1; i++) {
          if (grid[base + i]) {
            grid[base + i] = 0; rem++;
            if (a < 0) a = i; b = i;
            if (--this.cont[i] === 0) this.temZero = true;
            if (!this.colSuja[i]) { this.colSuja[i] = 1; this.listaSuja.push(i); }
            if (px) px[row + i] = 0;
          }
        }
        if (rem) { n += rem; soma += rem * (j + 0.5); this.marcar(a, b, j); }
      });
      if (n) { this.volume += soma * 2 * Math.PI * this.cel * this.cel * this.cel; this.versao++; }
      return n;
    }

    marcar(i0, i1, j) {
      const d = this.dr;
      if (!d) this.dr = { i0, i1, j0: j, j1: j };
      else { if (i0 < d.i0) d.i0 = i0; if (i1 > d.i1) d.i1 = i1; if (j < d.j0) d.j0 = j; if (j > d.j1) d.j1 = j; }
    }

    /* Depois de sangrar: tudo que ficou à direita de uma coluna vazia cai. */
    verificarSeparacao() {
      if (!this.temZero) return false;
      this.temZero = false;
      const { nz, nr, grid } = this;
      let iv = -1;
      for (let i = 0; i < nz; i++) if (this.cont[i] === 0) { iv = i; break; }
      if (iv < 0) return false;
      let soma = 0, i0 = -1, i1 = -1;
      for (let i = iv + 1; i < nz; i++) if (this.cont[i] > 0) { soma += this.cont[i]; if (i0 < 0) i0 = i; i1 = i; }
      if (!soma) return false;
      /* sobra mínima (casca do faceamento) não é peça solta: verifica de novo depois */
      if (soma * this.areaCel < 3 || (i1 - i0 + 1) * this.cel < 1.5) { this.temZero = true; return false; }
      for (let i = iv + 1; i < nz; i++) {
        if (!this.cont[i]) continue;
        for (let j = 0; j < nr; j++) {
          const k = j * nz + i;
          if (grid[k]) { grid[k] = 0; if (this.temCanvas) this.pxCorte[(nr - 1 - j) * nz + i] = 0; }
        }
        this.cont[i] = 0;
        if (!this.colSuja[i]) { this.colSuja[i] = 1; this.listaSuja.push(i); }
      }
      this.marcar(iv, nz - 1, 0); this.marcar(iv, nz - 1, nr - 1);
      this.versao++;
      return true;
    }

    pintarColVista(i) {
      if (!this.temCanvas) return;
      const { nz, nr } = this;
      const top = this.topo[i];
      const px = this.pxVista;
      const [cr, cg, cb] = this.cor;
      const ta = i > 0 ? this.topo[i - 1] : top, tb = i < nz - 1 ? this.topo[i + 1] : top;
      const borda = Math.abs(ta - top) > 1 || Math.abs(tb - top) > 1;
      const marca = (i % 4 === 0) ? 0.965 : 1;
      for (let j = 0; j < nr; j++) {
        const p = j * nz + i;
        if (j >= top) { px[p] = 0; continue; }
        const t = (j + 0.5) / top;
        let k = 0.26 + 0.58 * Math.sqrt(Math.max(0, 1 - t * t)) + 0.36 * Math.exp(-Math.pow((t - 0.32) / 0.11, 2));
        if (t > 0.93) k *= 0.8;
        if (borda) k *= 0.7;
        k *= marca;
        const r = Math.min(255, cr * k) | 0, g = Math.min(255, cg * k) | 0, b = Math.min(255, cb * k) | 0;
        px[p] = ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
      }
    }

    /* Atualiza topo das colunas alteradas e envia as imagens para os canvas. */
    flush() {
      if (this.listaSuja.length) {
        const rep = new Set();
        for (const i of this.listaSuja) {
          this.colSuja[i] = 0;
          let t = this.topo[i];
          while (t > 0 && !this.grid[(t - 1) * this.nz + i]) t--;
          if (t !== this.topo[i]) {
            this.topo[i] = t; rep.add(i);
            if (i > 0) rep.add(i - 1);
            if (i < this.nz - 1) rep.add(i + 1);
          }
        }
        this.listaSuja.length = 0;
        if (rep.size && this.temCanvas) {
          let a = Infinity, b = -Infinity;
          for (const i of rep) { this.pintarColVista(i); if (i < a) a = i; if (i > b) b = i; }
          this.ctxVista.putImageData(this.imgVista, 0, 0, a, 0, b - a + 1, this.nr);
        }
      }
      if (this.dr && this.temCanvas) {
        const d = this.dr;
        this.ctxCorte.putImageData(this.imgCorte, 0, 0, d.i0, this.nr - 1 - d.j1, d.i1 - d.i0 + 1, d.j1 - d.j0 + 1);
      }
      this.dr = null;
    }

    /* raio externo e interno de cada coluna (para a vista 3D) */
    perfil() {
      this.flush();
      const { nz, nr, cel, grid } = this;
      const ext = new Float32Array(nz), int = new Float32Array(nz);
      for (let i = 0; i < nz; i++) {
        if (!this.cont[i]) continue;
        ext[i] = this.topo[i] * cel;
        let j = 0;
        while (j < nr && !grid[j * nz + i]) j++;
        int[i] = j * cel;
      }
      return { ext, int };
    }
  }
  CNC.Material = Material;
})(window.CNC);
