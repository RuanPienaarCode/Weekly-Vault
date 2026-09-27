/* Harness entry: mounts the REAL view (src/view.js) over an in-memory vault
   of generic sample notes, dated around today, through the REAL store.
     ?theme=light   ?mobile=1   ?empty=1   ?nonudge=1   ?nowelcome=1   ?name=Sam */
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
    `- [ ] Renew passport ⏳ ${d(-40)}`,
    `- [ ] Pay the rates 📅 ${d(-3)} ⏫`,
    `- [ ] Email the landlord ⏳ ${d(-9)}`,
    `- [ ] Fix the gate ⏳ ${d(-20)}`,
    `- [ ] Order printer ink ⏳ ${d(-2)}`,
    `- [ ] Book the vet ⏳ ${d(-6)}`,
  ].join('\n'),
  'Templates/Daily.md': `- [ ] Template placeholder ⏳ ${d(0)}`,
  'Rhythm/Areas/Body.md': '---\nrhythm: area\norder: 1\n---\n',
  'Rhythm/Areas/Craft.md': '---\nrhythm: area\norder: 2\n---\n',
  'Rhythm/Practices/Gym.md': '---\nrhythm: practice\narea: Body\ncadence: 3/week\n---\n',
  'Rhythm/Practices/Paint.md': '---\nrhythm: practice\narea: Craft\ncadence: weekly\n---\n',
  'Rhythm/Practices/Read.md': '---\nrhythm: practice\narea: Craft\ncadence: daily\n---\n',
  'Rhythm/Practices/Stretch.md': '---\nrhythm: practice\narea: Body\ncadence: daily\n---\n',
  'Rhythm/Events/Dentist.md': `---\nrhythm: event\narea: Body\ndate: ${d(2)}\ntime: "14:00"\n---\n`,
  'Rhythm/Events/Team lunch.md': `---\nrhythm: event\ndate: ${d(4)}\n---\n`,
  [`Rhythm/Log/${d(3)}.md`]: '---\nrhythm: log\nplan: [Gym]\n---\n',
};
const reminders = [
  { title: 'Phone the dentist', due: d(1), time: '09:30', done: false, priority: 'normal', line: 2, raw: '', tags: [] },
  { title: 'Renew the licence disc', due: d(3), time: '', done: false, priority: 'high', line: 3, raw: '', tags: [] },
];
const nudgeStore = { isOurs: p => p === 'Reminders.md', path: () => 'Reminders.md', load: async () => ({ items: reminders }) };
const plugins = { rhythm: { settings: {} } };
if (q.get('nonudge') !== '1') plugins['nudge-reminders'] = { store: nudgeStore };
const app = makeApp(files, plugins);
app.workspace = { getLeaf: () => ({ openFile: async (f, o) => alert(`Would open ${f.path} at line ${o.eState.line + 1}`) }) };

const plugin = { app, settings: Object.assign({}, DEFAULT_SETTINGS, { excludeFolders: ['Templates'], name: q.get('name') || '' }), async saveData() {} };
if (q.get('nowelcome') === '1') plugin.settings.showWelcome = false;
plugin.store = makeStore(plugin);
plugin.openTask = async card => app.workspace.getLeaf().openFile(app.vault.getFileByPath(card.path), { eState: { line: card.line } });
const view = new FortnightView({ contentEl: document.getElementById('app') }, plugin);
window.__fn = { view, plugin, app };
view.onOpen();
