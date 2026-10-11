/* TornoLab CNC · editor.js
   Textarea transparente sobre um <pre> com realce de sintaxe do código G. */
window.CNC = window.CNC || {};
(function (CNC) {
  'use strict';

  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const CLASSE = { G: 't-g', M: 't-m', X: 't-ax', Z: 't-ax', U: 't-ax', W: 't-ax', R: 't-ar', I: 't-ar', K: 't-ar',
    F: 't-fs', S: 't-fs', T: 't-fs', N: 't-n', O: 't-o', P: 't-pq', Q: 't-pq' };

  function realcar(s) {
    let out = '', i = 0;
    const re = /^([A-Za-z])\s*([+-]?(?:\d+\.?\d*|\.\d+))?/;
    while (i < s.length) {
      const c = s[i];
      if (c === '(') {
        const j = s.indexOf(')', i), fim = j < 0 ? s.length : j + 1;
        out += `<span class="t-c">${esc(s.slice(i, fim))}</span>`; i = fim; continue;
      }
      if (c === ';') { out += `<span class="t-c">${esc(s.slice(i))}</span>`; break; }
      if (c === '%') { out += '<span class="t-o">%</span>'; i++; continue; }
      if (/[A-Za-z]/.test(c)) {
        const m = re.exec(s.slice(i));
        const cls = CLASSE[c.toUpperCase()] || 't-bad';
        out += `<span class="${m[2] === undefined ? 't-bad' : cls}">${esc(m[0])}</span>`;
        i += m[0].length; continue;
      }
      if (/\s|\//.test(c)) { out += c; i++; continue; }
      out += `<span class="t-bad">${esc(c)}</span>`; i++;
    }
    return out;
  }

  class Editor {
    constructor(raiz) {
      this.raiz = raiz;
      this.ta = raiz.querySelector('textarea');
      this.hl = raiz.querySelector('.ed-hl');
      this.gut = raiz.querySelector('.ed-gutter');
      this.exec = -1; this.erros = new Set(); this.ultCursor = -1;
      this.aoMudar = null; this.aoCursor = null;
      this.lh = parseFloat(getComputedStyle(raiz).getPropertyValue('--lh-code')) || 20;
      this.ta.addEventListener('input', () => { this.render(); if (this.aoMudar) this.aoMudar(); this.cursor(); });
      this.ta.addEventListener('scroll', () => this.sync());
      for (const ev of ['click', 'keyup', 'focus']) this.ta.addEventListener(ev, () => this.cursor());
      document.addEventListener('selectionchange', () => { if (document.activeElement === this.ta) this.cursor(); });
      this.ta.addEventListener('keydown', (e) => {
        if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.metaKey) { e.preventDefault(); this.digitar('  '); }
      });
    }
    get valor() { return this.ta.value; }
    set valor(v) { this.ta.value = v; this.ta.scrollTop = 0; this.ta.scrollLeft = 0; this.exec = -1; this.render(); this.cursor(true); }

    digitar(txt) {
      this.ta.focus();
      let ok = false;
      try { ok = document.execCommand('insertText', false, txt); } catch (e) { ok = false; }
      if (!ok) {
        const a = this.ta.selectionStart, b = this.ta.selectionEnd, v = this.ta.value;
        this.ta.value = v.slice(0, a) + txt + v.slice(b);
        this.ta.setSelectionRange(a + txt.length, a + txt.length);
        this.render(); if (this.aoMudar) this.aoMudar();
      }
    }

    render() {
      const linhas = this.ta.value.split('\n');
      let h = '', g = '';
      for (let i = 0; i < linhas.length; i++) {
        const c = (i === this.exec ? ' exec' : '') + (this.erros.has(i) ? ' err' : '');
        h += `<div class="l${c}">${realcar(linhas[i]) || ' '}</div>`;
        g += `<div class="${c.trim()}">${i + 1}</div>`;
      }
      this.hl.innerHTML = h + '<div class="l"> </div><div class="l"> </div>';
      this.gut.innerHTML = g + '<div> </div><div> </div>';
      this.sync();
    }
    sync() {
      this.hl.scrollTop = this.ta.scrollTop; this.hl.scrollLeft = this.ta.scrollLeft;
      this.gut.scrollTop = this.ta.scrollTop;
    }
    linhaCursor() { return this.ta.value.slice(0, this.ta.selectionStart).split('\n').length - 1; }
    linha(i) { const l = this.ta.value.split('\n'); return l[i] != null ? l[i] : ''; }
    cursor(forcar) {
      const l = this.linhaCursor();
      if (l !== this.ultCursor || forcar) { this.ultCursor = l; if (this.aoCursor) this.aoCursor(l, this.linha(l)); }
    }
    definirExec(i) {
      if (i === this.exec) return;
      const tira = (k) => { if (k >= 0) { this.hl.children[k] && this.hl.children[k].classList.remove('exec'); this.gut.children[k] && this.gut.children[k].classList.remove('exec'); } };
      tira(this.exec);
      this.exec = i;
      if (i >= 0) {
        if (this.hl.children[i]) this.hl.children[i].classList.add('exec');
        if (this.gut.children[i]) this.gut.children[i].classList.add('exec');
        this.mostrarLinha(i);
      }
    }
    marcarErros(lista) { this.erros = new Set(lista); this.render(); }
    mostrarLinha(i) {
      const top = i * this.lh, h = this.ta.clientHeight;
      if (top < this.ta.scrollTop + this.lh || top > this.ta.scrollTop + h - 3 * this.lh) {
        this.ta.scrollTop = Math.max(0, top - h / 3); this.sync();
      }
    }
    irPara(i) {
      const ls = this.ta.value.split('\n');
      let pos = 0;
      for (let k = 0; k < i && k < ls.length; k++) pos += ls[k].length + 1;
      this.ta.focus({ preventScroll: true });
      this.ta.setSelectionRange(pos, pos + (ls[i] || '').length);
      this.mostrarLinha(i);
      this.cursor(true);
    }
    inserir(txt) {
      const v = this.ta.value, p = this.ta.selectionEnd;
      const fim = v.indexOf('\n', p), pos = fim < 0 ? v.length : fim;
      this.ta.focus();
      this.ta.setSelectionRange(pos, pos);
      this.digitar('\n' + txt);
      this.cursor(true);
    }
  }
  CNC.Editor = Editor;
  CNC.realcar = realcar;
})(window.CNC);
