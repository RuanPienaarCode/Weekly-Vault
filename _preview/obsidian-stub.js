/* Minimal `obsidian` stand-in for the browser harness. Obsidian adds DOM
   helpers (createDiv, createEl, empty, addClass) to every element; the stub
   adds the same ones so the REAL src/ view renders unchanged. */
const proto = HTMLElement.prototype;
if (!proto.createEl) {
  proto.createEl = function (tag, o = {}) {
    const el = document.createElement(tag);
    if (o.cls) el.className = Array.isArray(o.cls) ? o.cls.filter(Boolean).join(' ') : o.cls;
    if (o.text != null) el.textContent = o.text;
    if (o.attr) for (const k of Object.keys(o.attr)) el.setAttribute(k, o.attr[k]);
    this.appendChild(el);
    return el;
  };
  proto.createDiv = function (o) { return this.createEl('div', typeof o === 'string' ? { cls: o } : o); };
  proto.createSpan = function (o) { return this.createEl('span', typeof o === 'string' ? { cls: o } : o); };
  proto.setText = function (t) { this.textContent = t; };
  proto.empty = function () { while (this.firstChild) this.removeChild(this.firstChild); };
  proto.addClass = function (...c) { this.classList.add(...c); };
  proto.removeClass = function (...c) { this.classList.remove(...c); };
  proto.toggleClass = function (c, on) { this.classList.toggle(c, on); };
}

export class Plugin {}
export class ItemView {
  constructor(leaf) { this.leaf = leaf; this.contentEl = (leaf && leaf.contentEl) || document.createElement('div'); }
}
export class PluginSettingTab {}
export class Setting {}
export class Modal {}
/* Enough of Obsidian's Menu to show and click a context menu. */
export class Menu {
  constructor() { this.items = []; }
  addSeparator() { return this; }
  addItem(fn) {
    const it = { title: '', disabled: false, cb: null };
    const api = { setTitle: t => { it.title = t; return api; }, setIcon: () => api, setDisabled: d => { it.disabled = d; return api; }, onClick: cb => { it.cb = cb; return api; } };
    fn(api); this.items.push(it); return this;
  }
  showAtMouseEvent(e) {
    document.querySelectorAll('.stub-menu').forEach(m => m.remove());
    const m = document.createElement('div');
    m.className = 'stub-menu';
    m.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;z-index:60;background:#fff;color:#000;border:1px solid #ccc;border-radius:8px;padding:4px;display:flex;flex-direction:column;font:13px system-ui`;
    for (const it of this.items) {
      const b = document.createElement('button');
      b.textContent = it.title; b.disabled = it.disabled;
      b.style.cssText = 'text-align:left;background:none;border:0;padding:6px 10px;cursor:pointer';
      b.onclick = () => { m.remove(); it.cb && it.cb(); };
      m.appendChild(b);
    }
    document.body.appendChild(m);
  }
}
/* Draws the notice (text or a fragment with buttons) top-right, as Obsidian does. */
export class Notice {
  constructor(msg, ms = 4000) {
    this.el = document.createElement('div');
    this.el.className = 'stub-notice';
    this.el.style.cssText = 'position:fixed;top:12px;right:12px;z-index:70;background:#222;color:#fff;padding:10px 14px;border-radius:8px;font:13px system-ui;max-width:360px';
    if (typeof msg === 'string') this.el.textContent = msg; else this.el.appendChild(msg);
    document.body.appendChild(this.el);
    console.log('[notice]', this.el.textContent);
    setTimeout(() => this.hide(), ms);
  }
  hide() { this.el.remove(); }
}
/* A text glyph per icon name, so icon-only buttons are visible here. */
const GLYPH = { inbox: '▭', 'calendar-range': '▦', plus: '+', circle: '○', 'check-circle-2': '✓', lock: '🔒', bell: '🔔', repeat: '↻', sun: '☀', calendar: '▦' };
export function setIcon(el, name) { el.textContent = GLYPH[name] || ''; }
export const Platform = { isMobile: new URLSearchParams(location.search).get('mobile') === '1', isPhone: new URLSearchParams(location.search).get('mobile') === '1' };
export const normalizePath = p => p.replace(/\\/g, '/').replace(/\/+$/, '');
