# LP-Collection

A phone app for cataloguing vinyl LPs: scan a record's barcode, find the Release on Discogs, and keep it with its value in PostgreSQL. See `GLOSSARY.md` for the terms and `docs/adr/` for the big decisions.

One TypeScript app serves both the API (Hono, under `/api`) and the React phone UI, and builds into one container image.

## Run it locally

You need Node.js 24 or newer and a PostgreSQL database.

```sh
npm install
npm run build
DATABASE_URL=postgres://user:password@localhost:5432/lp_collection APP_OWNER_DISCOGS_USERNAME=your-discogs-name DISCOGS=fake npm start
```

Open http://localhost:3000. The app runs its database migrations when it starts.

`APP_OWNER_DISCOGS_USERNAME` names the app's Owner: the Discogs user who can log in without an Invite and create Invites for everyone else. The Owner's first login ties the role to their Discogs account, so renaming that account on Discogs keeps the Owner's rights and nobody gets them by taking the old name. To hand the role to someone else, change the setting; that person becomes the Owner at their next login.

`PUBLIC_URL` is the address phones open, such as `https://lp-collection.peytonhunter.com`. Invite links and the Discogs login send people there, and an `https://` address makes the login cookie Secure. Locally it defaults to `http://localhost:<PORT>`; set it to your computer's network address to try the app from a phone. In production the app refuses to start without it, and it must start with `https://`.

While working on the UI, run `npm start` in one terminal and `npm run dev` in another, then open the address Vite prints. It reloads on save and forwards `/api` to the server.

The app logs in through the real Discogs when `DISCOGS_CONSUMER_KEY` and `DISCOGS_CONSUMER_SECRET` are set; run `scripts/wizard/discogs.sh` to get them. Without them it refuses to start. With them it also needs `TOKEN_ENCRYPTION_KEY`, 32 random bytes in base64 (`openssl rand -base64 32`), to encrypt each User's Discogs tokens in the database. The wizard generates it and keeps the one already in the cluster, because a new key makes the stored tokens unreadable. To try it on your own computer without Discogs, add `DISCOGS=fake` to the start command. Its "Log in with Discogs" then opens a Fake Discogs page that only asks for a username: type the app Owner's username to log in as the Owner, or any other name to play an invited friend. Anyone can log in as anyone there, so the app refuses `DISCOGS=fake` in production (`NODE_ENV=production`, as in the container image).

After changing `src/server/schema.ts`, run `npm run db:generate` and commit the new files in `drizzle/`.

## Run the tests

```sh
npm test            # API tests against a throwaway PostgreSQL and a scripted fake Discogs
npm run test:e2e    # browser tests at iPhone size
npm run typecheck
```

Neither test command needs a database of your own: they start a throwaway PostgreSQL themselves. Both log in through the fake Discogs, so neither needs Discogs keys. Before the first browser test run, install the browser once with `npx playwright install chromium`.

GitHub Actions runs all of this, and builds the container image, on every push and pull request.

## Deploy

The app runs on the home k3s cluster at https://lp-collection.peytonhunter.com. A Cloudflare Tunnel carries phones to it, so no port is open at home (see `docs/adr/0003`).

Every change merged to main makes GitHub build a new image, `ghcr.io/peyhunter/lp-collection:sha-<commit>`. The cluster setup lives in `deploy/`: the app, its PostgreSQL database, and the tunnel connector. PostgreSQL keeps its data on k3s-2's disk.

Run the wizard only after the pull request that added `deploy/` is merged, because until then there is no image and no `deploy/` folder on main.

To put the app online the first time, run this on k3s-2 from the repo folder and follow the steps:

```sh
scripts/wizard/deploy.sh
```

It creates the Cloudflare Tunnel and the address, stores the passwords and keys in the cluster (never in this repo), runs the Discogs wizard if the keys are missing, and switches the app on in Argo CD. Run it again at any time: it keeps what's already done.

To ship a newer version, change the `sha-` tag in `apps/lp-collection.yaml` in the k3s-gitops repo to the newest one from the Publish runs on GitHub, and push. Argo CD rolls it out.

The database lives on a local-path volume, which is deleted together with its claim. Deleting the app in Argo CD keeps the namespace, the claim and the secrets. Never delete the `lp-collection` namespace or the `data-postgres-0` claim by hand, because that deletes the data.

Only the tunnel connector can reach the app, and only the app can reach the database. `deploy/network-policy.yaml` sets this, and k3s enforces it.

The app encrypts the Discogs tokens it stores. A backup of the database taken by an older version, from before token encryption, holds the tokens in plain text, and nightly backups are kept for 30 days (see `docs/adr/0003`). To remove such a backup sooner, delete its dated dump files from the backup storage on k3s-1. Nightly backups do not exist yet, so the first deploy creates none of these.

## Build the container image

```sh
docker build -t lp-collection .
docker run -e DATABASE_URL=... -e PUBLIC_URL=https://lp-collection.peytonhunter.com -e APP_OWNER_DISCOGS_USERNAME=... -e DISCOGS_CONSUMER_KEY=... -e DISCOGS_CONSUMER_SECRET=... -e TOKEN_ENCRYPTION_KEY=... -p 3000:3000 lp-collection
```
