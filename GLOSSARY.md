# LP-Collection

A phone app for cataloguing vinyl LPs. Each user scans or looks up their records against Discogs, and the app stores them with their current market value.

## Language

### People

**User**:
A person who logs in to LP-Collection with their own Discogs account.
_Avoid_: account (ambiguous with the Discogs account)

**Owner**:
The User a Collection belongs to. Copies added to the Collection also go into the Owner's Discogs collection.

**App Owner**:
The one User who runs this LP-Collection, named by their Discogs username in the app's settings. Only the App Owner can log in without an Invite and create Invites. They are also the Owner of their own Collection.
_Avoid_: admin, Owner (when you mean the App Owner)

**Member**:
A User the Owner has given access to their Collection. The Owner is also a Member.
_Avoid_: guest, shared user

**Invite**:
A link that lets one person become a User. Nobody can sign up without one.

### Records

**Release**:
One specific pressing of an album as Discogs lists it, identified by its Discogs release ID. A 1969 UK first press and a 2015 reissue of the same album are different Releases.
_Avoid_: LP (when you mean the pressing), album, edition

**Copy**:
One physical record a user owns. It points to a Release and has its own condition and value. Two identical records are two Copies.
_Avoid_: LP, item, entry

**Collection**:
A set of Copies that one or more Members look after together. Every Collection has exactly one Owner.
_Avoid_: library, catalogue

**Original year**:
The year the music was first released, whatever pressing this is. Sorting by year uses this by default.
_Avoid_: year (when ambiguous)

**Pressing year**:
The year this Release was manufactured.

**Period**:
The decade of the Original year (60s, 70s, ...).
_Avoid_: era

### Where records live

**Shelf**:
One shelving unit in a Collection, with one photo of its front and a grid of rows and columns laid over that photo.
_Avoid_: rack, unit (in the UI)

**Section**:
One square of a Shelf, labelled by row letter and column number from the top left ("C4"). A Copy lives in at most one Section.
_Avoid_: cube, bin, slot

**Not on a shelf**:
A Copy with no Section yet, or whose Section was removed.

### Condition and value

**Media condition**:
The grade of the vinyl itself, on the Discogs scale: Mint, Near Mint, Very Good Plus, Very Good, Good Plus, Good, Fair, Poor. It defaults to Very Good Plus.

**Sleeve condition**:
The grade of the cover, on the same scale as Media condition. It defaults to Very Good Plus.

**Value**:
The Discogs suggested price for a Release in a Copy's Media condition. This is the main number shown and sorted on.
_Avoid_: price, worth

**Lowest listing**:
The cheapest asking price on the Discogs marketplace for a Release right now. It ignores condition and can be missing.
_Avoid_: value

**Purchase price**:
What a User paid for a Copy, with the date they bought it. It's optional.
_Avoid_: cost

**Gain**:
A Copy's current Value minus its Purchase price. It can be negative.
_Avoid_: profit, return

**Collection value**:
The sum of the Values of all Copies in a Collection. Copies with no Value count as zero.
_Avoid_: total, net worth

**Value history**:
The Value of each Copy and the Collection value, recorded at each monthly refresh.

### Finding a Release

**Lookup**:
Turning something the user has (a barcode, a catalog number, or an artist and title) into candidate Releases. The user picks one when several match.
_Avoid_: scan (scanning is only the barcode path)

**Catalog number**:
The label's code for a Release, printed on the spine or label (e.g. "PCS 7027").
