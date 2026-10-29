# The app is the source of truth, Discogs is a one-way mirror

When a User first logs in, LP-Collection imports their existing Discogs collection once. After that, every add, change and delete of a Copy is pushed to the Owner's Discogs collection, but changes made on the Discogs website are never pulled back. Two-way sync would mean resolving conflicts between edits made in two places (and Discogs has no change feed to tell us what changed). A one-way mirror still gives a free off-site backup and Discogs' own collection totals.
