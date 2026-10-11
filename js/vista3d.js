/* TornoLab CNC · vista3d.js
   Revoluciona o perfil atual da peça e desenha em 3D com o algoritmo do pintor
   (canvas 2D, sem bibliotecas). Arraste para girar, role para aproximar. */
window.CNC = window.CNC || {};
(function (CNC) {
  'use strict';
  const SEG = 72;

  function rdp(pts, eps) {
    if (pts.length < 3) return pts.slice();
    const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
    const pilha = [[0, pts.length - 1]];
    while (pilha.length) {
      const [a, b] = pilha.pop();
      const [ax, ay] = pts[a], [bx, by] = pts[b];
      const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1e-12;
      let dmax = -1, idx = -1;
      for (let i = a + 1; i < b; i++) {
        const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / L;
        if (d > dmax) { dmax = d; idx = i; }
      }
      if (dmax > eps) { keep[idx] = 1; pilha.push([a, idx], [idx, b]); }
    }
    return pts.filter((_, i) => keep[i]);
  }

  class Vista3D {
    constructor(canvas) {
      this.cv = canvas; this.ctx = canvas.getContext('2d');
      this.yaw = -0.62; this.pitch = 0.36; this.zoom = 1;
      this.n = 0; this.versao = -1; this.ultimo = 0; this.precisa = true;
      this.ligar();
    }
    tamanho() {
      const r = this.cv.getBoundingClientRect();
      if (r.width < 2) return;
      this.dpr = Math.min(2, window.devicePixelRatio || 1);
      this.W = r.width; this.H = r.height;
      this.cv.width = Math.round(r.width * this.dpr); this.cv.height = Math.round(r.height * this.dpr);
      this.precisa = true;
    }
    ligar() {
      const cv = this.cv; let ult = null;
      cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); ult = { x: e.clientX, y: e.clientY }; cv.classList.add('arrastando'); });
      cv.addEventListener('pointermove', (e) => {
        if (!ult) return;
        this.yaw += (e.clientX - ult.x) * 0.008;
        this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch + (e.clientY - ult.y) * 0.008));
        ult = { x: e.clientX, y: e.clientY }; this.precisa = true;
      });
      const fim = () => { ult = null; cv.classList.remove('arrastando'); };
      cv.addEventListener('pointerup', fim); cv.addEventListener('pointercancel', fim);
      cv.addEventListener('wheel', (e) => { e.preventDefault(); this.zoom = Math.max(0.3, Math.min(8, this.zoom * Math.exp(-e.deltaY * 0.0015))); this.precisa = true; }, { passive: false });
      cv.addEventListener('dblclick', () => { this.yaw = -0.62; this.pitch = 0.36; this.zoom = 1; this.precisa = true; });
    }

    construir(mat, bruta) {
      const { ext, int } = mat.perfil();
      const nz = mat.nz, cel = mat.cel, z0 = mat.zMin;
      let i0 = -1, i1 = -1;
      for (let i = 0; i < nz; i++) if (ext[i] > 0) { if (i0 < 0) i0 = i; i1 = i; }
      const V = [], N = [], C = [];
      const quad = (a, b, c, d, n, tipo) => { V.push(...a, ...b, ...c, ...d); N.push(...n); C.push(tipo); };
      const revolver = (laco, tipo) => {
        for (let k = 0; k < laco.length; k++) {
          const p = laco[k], q = laco[(k + 1) % laco.length];
          if (p[1] < 1e-6 && q[1] < 1e-6) continue;
          const dz = q[0] - p[0], dr = q[1] - p[1], L = Math.hypot(dz, dr);
          if (L < 1e-6) continue;
          const nz_ = -dr / L, nr_ = dz / L;
          for (let s = 0; s < SEG; s++) {
            const t0 = (s / SEG) * 2 * Math.PI, t1 = ((s + 1) / SEG) * 2 * Math.PI, tm = (t0 + t1) / 2;
            const c0 = Math.cos(t0), s0 = Math.sin(t0), c1 = Math.cos(t1), s1 = Math.sin(t1);
            quad([p[0], p[1] * c0, p[1] * s0], [q[0], q[1] * c0, q[1] * s0], [q[0], q[1] * c1, q[1] * s1], [p[0], p[1] * c1, p[1] * s1],
              [nz_, nr_ * Math.cos(tm), nr_ * Math.sin(tm)], tipo);
          }
        }
      };
      if (i0 >= 0) {
        const sup = [], inf = [];
        for (let i = i0; i <= i1; i++) {
          const zl = z0 + i * cel, zr = zl + cel;
          sup.push([zl, ext[i]], [zr, ext[i]]);
          inf.push([zl, int[i]], [zr, int[i]]);
        }
        const S = rdp(sup, cel * 0.8), I = rdp(inf, cel * 0.8);
        revolver(S.concat(I.slice().reverse()), 0);
      }
      const P = CNC.PLACA, R = bruta.d / 2, zf = -bruta.l, zc1 = zf - P.castanhaL, zc0 = zc1 - P.corpoL;
      const H = R + P.castanhaH, Rb = H + P.corpoFolga;
      revolver([[zc0, 0], [zc0, Rb], [zc1, Rb], [zc1, 0]], 1);
      const w = P.castanhaLarg / 2;
      for (let k = 0; k < 3; k++) {
        const phi = Math.PI / 2 + (k * 2 * Math.PI) / 3, c = Math.cos(phi), s = Math.sin(phi);
        const pt = (z, rho, t) => [z, rho * c - t * s, rho * s + t * c];
        const nrm = (a, b) => [0, a * c - b * s, a * s + b * c];
        const za = zc1, zb = zf;
        quad(pt(za, H, -w), pt(zb, H, -w), pt(zb, H, w), pt(za, H, w), nrm(1, 0), 2);
        quad(pt(za, R, w), pt(zb, R, w), pt(zb, H, w), pt(za, H, w), nrm(0, 1), 2);
        quad(pt(za, R, -w), pt(za, H, -w), pt(zb, H, -w), pt(zb, R, -w), nrm(0, -1), 2);
        quad(pt(zb, R, -w), pt(zb, H, -w), pt(zb, H, w), pt(zb, R, w), [1, 0, 0], 2);
      }
      this.V = new Float32Array(V); this.N = new Float32Array(N); this.C = new Uint8Array(C);
      this.n = C.length;
      this.centro = ((bruta.face || 0) + zc1) / 2;
      this.tam = Math.max((bruta.face || 0) - zc0, 2 * Rb);
      this.base = mat.cor;
      this.precisa = true;
    }

    talvez(mat, bruta, agora, forcar) {
      if (forcar || (mat.versao !== this.versao && agora - this.ultimo > 280)) {
        this.versao = mat.versao; this.ultimo = agora;
        this.construir(mat, bruta);
      }
      if (this.precisa) { this.desenhar(); this.precisa = false; }
    }

    desenhar() {
      if (!this.W) return;
      const ctx = this.ctx, W = this.W, H = this.H;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      const g = ctx.createRadialGradient(W * 0.5, H * 0.35, 10, W * 0.5, H * 0.5, Math.max(W, H) * 0.75);
      g.addColorStop(0, '#1a2129'); g.addColorStop(1, '#07090c');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      if (!this.n) return;
      const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw), cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
      const esc = (Math.min(W, H) * 0.7 / this.tam) * this.zoom;
      const Dc = this.tam * 3.2;
      const n = this.n, V = this.V, Nn = this.N;
      const sx = new Float32Array(n * 8), prof = new Float32Array(n), vis = new Uint8Array(n), luz = new Float32Array(n * 2);
      const L1 = [-0.42, 0.72, 0.55], L2 = [0.65, -0.25, 0.45];
      const nl = (v) => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
      const l1 = nl(L1), l2 = nl(L2), hv = nl([l1[0], l1[1], l1[2] + 1]);
      const cx = W / 2, cyy = H / 2 + H * 0.04;
      for (let q = 0; q < n; q++) {
        let zs = 0, px = 0, py = 0, pz = 0;
        for (let k = 0; k < 4; k++) {
          const o = q * 12 + k * 3;
          const x = V[o] - this.centro, y = V[o + 1], z = V[o + 2];
          const x1 = x * cy + z * sy, z1 = -x * sy + z * cy;
          const y2 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;
          const f = Dc / (Dc - z2);
          sx[q * 8 + k * 2] = cx + x1 * esc * f; sx[q * 8 + k * 2 + 1] = cyy - y2 * esc * f;
          zs += z2; px += x1; py += y2; pz += z2;
        }
        prof[q] = zs / 4; px /= 4; py /= 4; pz /= 4;
        const a = Nn[q * 3], b = Nn[q * 3 + 1], c = Nn[q * 3 + 2];
        const n1 = a * cy + c * sy, nz1 = -a * sy + c * cy;
        const n2 = b * cp - nz1 * sp, nz2 = b * sp + nz1 * cp;
        if (n1 * -px + n2 * -py + nz2 * (Dc - pz) <= 0) continue;
        vis[q] = 1;
        luz[q * 2] = Math.max(0, n1 * l1[0] + n2 * l1[1] + nz2 * l1[2]) * 0.72 + Math.max(0, n1 * l2[0] + n2 * l2[1] + nz2 * l2[2]) * 0.22;
        luz[q * 2 + 1] = Math.pow(Math.max(0, n1 * hv[0] + n2 * hv[1] + nz2 * hv[2]), 42);
      }
      const ord = [];
      for (let q = 0; q < n; q++) if (vis[q]) ord.push(q);
      ord.sort((a, b) => prof[a] - prof[b]);
      const bases = [this.base, [64, 71, 80], [92, 100, 112]];
      const brilho = [0.65, 0.18, 0.3];
      ctx.lineJoin = 'round'; ctx.lineWidth = 0.7;
      for (const q of ord) {
        const t = this.C[q], bc = bases[t];
        const k = 0.17 + luz[q * 2], e = luz[q * 2 + 1] * 255 * brilho[t];
        const r = Math.min(255, bc[0] * k + e) | 0, gg = Math.min(255, bc[1] * k + e) | 0, bb = Math.min(255, bc[2] * k + e) | 0;
        const col = `rgb(${r},${gg},${bb})`;
        const o = q * 8;
        ctx.beginPath();
        ctx.moveTo(sx[o], sx[o + 1]); ctx.lineTo(sx[o + 2], sx[o + 3]); ctx.lineTo(sx[o + 4], sx[o + 5]); ctx.lineTo(sx[o + 6], sx[o + 7]);
        ctx.closePath();
        ctx.fillStyle = col; ctx.strokeStyle = col;
        ctx.fill(); ctx.stroke();
      }
    }
  }
  CNC.Vista3D = Vista3D;
})(window.CNC);
