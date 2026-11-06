# FieldShift accounts

Run `npm run dev` with Node.js 22.13 or newer, then visit
http://127.0.0.1:4173. The local server creates a SQLite database at
`.local/fieldshift.sqlite`; back it up to preserve local accounts. Local
accounts are separate from those on the published site.

Create an account using a unique username and password, or use guest mode.
Guest work lasts only in the current tab. Signed-in workspaces save to the
server and use revision checks to prevent silent overwrites. Passwords are
stored as salted hashes. The workspace request limit is 1 MB; export large
photo collections as a backup.

The account interface currently uses username and password. Email verification
and password recovery are not configured. The backend includes optional Google
OAuth support, but it is not enabled in the current interface.
