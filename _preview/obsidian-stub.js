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
export class Menu {}
export class Notice { constructor(msg) { console.log('[notice]', msg); } }
export function setIcon() {}
export const Platform = { isMobile: new URLSearchParams(location.search).get('mobile') === '1' };
export const normalizePath = p => p.replace(/\\/g, '/').replace(/\/+$/, '');
