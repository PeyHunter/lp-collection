# LP-Collection

A phone app for cataloguing vinyl LPs: scan a record's barcode, find the Release on Discogs, and keep it with its value in PostgreSQL. See `GLOSSARY.md` for the terms and `docs/adr/` for the big decisions.

One TypeScript app serves both the API (Hono, under `/api`) and the React phone UI, and builds into one container image.

## Run it locally

You need Node.js 24 or newer and a PostgreSQL database.

```sh
npm install
npm run build
DATABASE_URL=postgres://user:password@localhost:5432/lp_collection APP_OWNER_DISCOGS_USERNAME=your-discogs-name npm start
```

Open http://localhost:3000. The app runs its database migrations when it starts.

`APP_OWNER_DISCOGS_USERNAME` names the app's Owner: the Discogs user who can log in without an Invite and create Invites for everyone else.

While working on the UI, run `npm start` in one terminal and `npm run dev` in another, then open the address Vite prints. It reloads on save and forwards `/api` to the server.

Without `DISCOGS_CONSUMER_KEY` and `DISCOGS_CONSUMER_SECRET` the app uses a fake Discogs. Its "Log in with Discogs" opens a Fake Discogs page that only asks for a username: type the app Owner's username to log in as the Owner, or any other name to play an invited friend. With both keys set, it logs in through the real Discogs. In production (`NODE_ENV=production`, as in the container image) the app refuses to start without the keys; run `scripts/wizard/discogs.sh` to get them.

After changing `src/server/schema.ts`, run `npm run db:generate` and commit the new files in `drizzle/`.

## Run the tests

```sh
npm test            # API tests against a throwaway PostgreSQL and a scripted fake Discogs
npm run test:e2e    # browser tests at iPhone size
npm run typecheck
```

Neither test command needs a database of your own: they start a throwaway PostgreSQL themselves. Both log in through the fake Discogs, so neither needs Discogs keys. Before the first browser test run, install the browser once with `npx playwright install chromium`.

GitHub Actions runs all of this, and builds the container image, on every push and pull request.

## Build the container image

```sh
docker build -t lp-collection .
docker run -e DATABASE_URL=... -e APP_OWNER_DISCOGS_USERNAME=... -e DISCOGS_CONSUMER_KEY=... -e DISCOGS_CONSUMER_SECRET=... -p 3000:3000 lp-collection
```
