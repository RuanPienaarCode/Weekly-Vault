# Fortnight

Plan two weeks, live one day. Fortnight is an Obsidian board where you plan the next two weeks on a Sunday, then adjust each morning and review each evening.

It keeps no store of its own. To-dos are ordinary [Tasks](https://github.com/obsidian-tasks-group/obsidian-tasks) checkbox lines, so the day a card sits on is its ⏳ scheduled date:

| Where the card sits | The line carries |
|---|---|
| A day | `⏳ YYYY-MM-DD` |
| Next week | `🛫` next Monday, no `⏳` |
| Later | neither |

A `📅` due date is never changed by moving a card.

> Early development. See `docs/` for the product requirements and the build plan.

## Development

```bash
./build.sh            # bundle src/ → main.js, node --check, run tests/
./scripts/deploy.sh   # copy into the vault and prove it by sha256
npm run preview       # build the browser harness, then serve on :8824
```

Root `main.js` and `styles.css` are build output. Edit `src/` only.

## Licence

AGPL-3.0-only
