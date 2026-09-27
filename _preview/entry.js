/* Harness entry: mounts the REAL view (src/view.js) into the page.
     ?theme=light   ?mobile=1 */
const { FortnightView } = require('../src/view');

const q = new URLSearchParams(location.search);
if (q.get('mobile') === '1') document.body.classList.add('is-mobile');
if (q.get('theme') === 'light') { document.body.classList.remove('theme-dark'); document.body.classList.add('theme-light'); }

const plugin = { settings: {}, async saveSettings() {} };
const view = new FortnightView({ contentEl: document.getElementById('app') }, plugin);
window.__fn = { view, plugin };
view.onOpen();
