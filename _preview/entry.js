/* Harness entry: mounts the REAL view (src/view.js) over an in-memory vault
   of generic sample notes, dated around today, through the REAL store.
     ?theme=light   ?mobile=1   ?empty=1 */
const { FortnightView } = require('../src/view');
const { makeStore } = require('../src/store');
const { DEFAULT_SETTINGS } = require('../src/constants');
const D = require('../src/dates');
const { makeApp } = require('../tests/_stub.cjs');

const q = new URLSearchParams(location.search);
if (q.get('mobile') === '1') document.body.classList.add('is-mobile');
if (q.get('theme') === 'light') { document.body.classList.remove('theme-dark'); document.body.classList.add('theme-light'); }

const T = D.todayISO();
const d = n => D.addDays(T, n);
const files = q.get('empty') === '1' ? {} : {
  'Home.md': [
    '# Home', '',
    `- [ ] Call plumber about the leak ⏳ ${d(0)} ⏫`,
    `- [ ] Buy light bulbs ⏳ ${d(0)}`,
    `- [ ] Book car service ⏳ ${d(1)} 📅 ${d(3)}`,
    `- [x] Water the garden ⏳ ${d(0)} ✅ ${d(0)}`,
    '- [ ] Sort out the garage',
  ].join('\n'),
  'Work/Projects.md': [
    '# Projects', '',
    `- [ ] Send the quarterly invoice 📅 ${d(2)}`,
    `- [ ] Draft the proposal ⏳ ${d(-1)}`,
    `- [ ] Review pull requests ⏳ ${d(2)} 🔽`,
    `> - [ ] Prepare slides for Friday ⏳ ${d(4)} 🔼`,
  ].join('\n'),
  'Templates/Daily.md': `- [ ] Template placeholder ⏳ ${d(0)}`,
};
const app = makeApp(files);
app.workspace = { getLeaf: () => ({ openFile: async (f, o) => alert(`Would open ${f.path} at line ${o.eState.line + 1}`) }) };

const plugin = { app, settings: Object.assign({}, DEFAULT_SETTINGS, { excludeFolders: ['Templates'] }) };
plugin.store = makeStore(plugin);
plugin.openTask = async card => app.workspace.getLeaf().openFile(app.vault.getFileByPath(card.path), { eState: { line: card.line } });
const view = new FortnightView({ contentEl: document.getElementById('app') }, plugin);
window.__fn = { view, plugin, app };
view.onOpen();
