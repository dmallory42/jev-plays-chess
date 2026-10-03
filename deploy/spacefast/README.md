# Spacefast

The live site runs on [Spacefast](https://spacefast.com) Functions with its MySQL database.

Each file under `functions/api/` is a Spacefast route that hands the request to the shared app. `build.mjs` bundles them into `.deploy/` alongside the built viewer, and writes `sf.jsonc` with a cron that calls `/api/tick` every minute.

Set the key once, then deploy from the repo root:

```bash
npx spacefast env set TYPESAFE_API_KEY --value-from-stdin < key.txt
npm run deploy
```
