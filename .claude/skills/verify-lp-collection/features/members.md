# Members and shared Collections

The Owner adds another User as a Member of their Collection by Discogs username, and can remove them again. Members add, change and delete Copies; their changes mirror to the Owner's Discogs collection. A User in several Collections switches between them with one tap. No one sees a Collection they aren't a Member of.

## Sub-features

- `members` is a "Members" section on the Collection listing the Owner first, then the Members. Only the Owner sees "Add a Member by Discogs username" and a "Remove" button per Member. Adding someone who isn't a User yet says to send them an Invite first.
- `switcher` is a "Collection" group of chips ("Yours", "owner's") above the Overview, shown to Users in more than one Collection. The title follows ("owner's Collection"), and the device remembers the choice.
- `removed` leaves the Copies a removed Member added in the Collection; the Member's next load is back in their own.
- `isolation`: every `/api/collections/:collectionId/...` route answers a non-Member `404 { "error": "No such Collection" }`.

## How to get to it (user POV)

- Owner: Collection (`/`), scroll to "Members".
- Member: tap the Collection chip at the top of the Collection.
- API: `GET /api/me` answers `collections: [{ id, ownerDiscogsUsername, own }]`, own first. `GET /api/collections/<id>/members` answers `{ members: [{ userId, discogsUsername, owner }] }`. `POST …/members` with `{ "discogsUsername": "…" }` answers `201` (or `200` if already a Member); `DELETE …/members/<userId>` answers `204`. Only the Owner may change Members (`403` otherwise), and the Owner can't remove themselves (`400`).

## Driving it with verify-lp-collection

Preconditions: baseline state, `doctor.ts` reports `HEALTHY`.

- Log in as `owner`, save Discovery, create an Invite, and log in through it as `friend`.
- As `owner`, add `stranger` (refused: send an Invite first), then `friend`.
- As `friend`, reload: two Collection chips. Tap "owner's": the title and Copies are the owner's.
- As `owner`, remove `friend`. As `friend`, reload: back in their own Collection with no chips, and the owner's Collection answers `404`.
- `node .claude/skills/verify-lp-collection/bin/drive-members.ts <run-id>` drives all of this and saves `owner-members.png`, `friend-own-collection.png`, `friend-in-owners-collection.png`, `removed-member-copies.http.txt` and `console-errors.json`. The expected console errors are the `401` before each login and the `404` from adding `stranger`.

## Gotchas

- Invites stay with the App Owner (GLOSSARY: only the App Owner creates Invites). A Collection's Owner adds Members who are already Users.
- `test/api/members.test.ts` sends every Collection route as a non-Member and expects `404` from each, so a new route is covered automatically.
