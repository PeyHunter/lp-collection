# Invite and log in

Nobody can sign up without an Invite (ADR-0001). The app's Owner logs in with Discogs and creates an Invite link that works once and expires after 7 days. The invited person opens the link, logs in with Discogs and lands in a new, empty Collection of their own. A User stays logged in across reloads until they log out. Without an Invite or an account, the app shows an invite-only message.

## Sub-features

- `invite-only` shows "LP-Collection is invite only." on `/` with no session, plus a "Log in with Discogs" link for returning Users.
- `owner-login` logs the app's Owner in without an Invite.
- `invite-create` lets the app's Owner create an Invite and shows its link with a "Copy link" button and its expiry date. Other Users see no "Invite someone" section, and `POST /api/invites` answers them `403`.
- `invite-accept` opens a valid Invite, logs in through Discogs and lands on "Your Collection" with "No Copies yet."
- `invite-refused` shows "This Invite has already been used.", "This Invite has expired." or "This Invite link isn't valid." instead of a log-in link.
- `session` keeps the User logged in after a reload. The cookie `lp_session` lasts 400 days.
- `logout` ends the session and returns to the invite-only message.

## How to get to it (user POV)

- Open `/` with no session.
- Tap "Log in with Discogs" on `/` (returning User or the app's Owner).
- As the app's Owner on `/`, tap "Create Invite", then "Copy link".
- Open an Invite link, `/invite/<code>`, and tap "Log in with Discogs".
- Tap "Log out" on `/`.
- API: `GET /api/me`, `POST /api/invites`, `GET /api/invites/<code>`, `GET /api/login[?invite=<code>]`, `GET /api/login/callback`, `POST /api/logout`.

## Driving it with verify-lp-collection

Preconditions:

- Baseline state, `doctor.ts` reports `HEALTHY`. The launcher names `owner` as the app's Owner.
- Discogs is the fake: "Log in with Discogs" opens a page headed "Fake Discogs" with a "Discogs username" field and an "Authorize" button. The username you type is who you are on Discogs.

- **Invite only.** Run `look.ts <run-id> / invite-only`. The snapshot has the text "LP-Collection is invite only." and a link "Log in with Discogs".
- **Owner creates an Invite.** Write a Playwright script in the evidence folder with `devices["iPhone 15"]`. In one browser context, open `/`, tap the link "Log in with Discogs", fill "Discogs username" with `owner`, tap "Authorize". Expect the heading "Your Collection" and the heading "Invite someone". Tap "Create Invite" and read the value of the field "Invite link". Screenshot it.
- **Invitee logs in.** In a second, fresh browser context (a different phone), open the Invite link. Expect the heading "You're invited to LP-Collection". Tap "Log in with Discogs", fill `friend`, tap "Authorize". Expect "Your Collection", "No Copies yet.", "Logged in as friend." and no "Invite someone" heading.
- **Stays logged in.** Reload in the invitee's context. "Your Collection" is still shown. This is the read-back that the User was stored.
- **Logs out.** Tap "Log out". Expect "LP-Collection is invite only." and, after a reload, still no "Your Collection".
- **Reused Invite.** Open the same Invite link again in a third fresh context. Expect the heading "This Invite has already been used." and no log-in link. Save `curl -s -i <appUrl>/api/invites/<code>` as `invite-used.http.txt`; it answers `410` with `{"status":"used"}`.
- **Unknown Invite.** Run `look.ts <run-id> /invite/not-a-real-code invite-unknown`. The heading is "This Invite link isn't valid."

## Gotchas

- Chromium logs every 4xx answer to a fetch as a console error. A `401 (Unauthorized)` from `/api/me` with no session and a `410 (Gone)` from `/api/invites/<code>` for a used or expired Invite are expected. Any other console error is a failure.
- A Discogs user who is already a User and opens an Invite just logs in, and the Invite stays unused. Use a new username for the invitee on every drive against the same run.

- Expiry after 7 days cannot be driven here: the launched app uses the real clock. `test/api/invite-login.test.ts` covers it with a controlled clock. Report `invite-refused` (expired) as not driven.
- Use a fresh browser context per person. Contexts share no cookies, like two phones. One context reused for the invitee is still logged in as the Owner.
- The fake keeps its pending logins in memory. A relaunch between tapping "Log in with Discogs" and "Authorize" shows "This login has expired."
- "Copy link" needs clipboard permission in a scripted browser. Read the "Invite link" field instead of the clipboard.
- The real Discogs login is not drivable here. It needs the keys that `scripts/wizard/discogs.sh` stores in the cluster.
