FieldShift accounts

Email and password accounts use the hosted D1 database declared as DB. Passwords are hashed with per-account salts; session cookies are HttpOnly and Secure. Guests use tab-only storage. Account workspaces save to D1 with revision checks to prevent one tab silently overwriting another. A save error remains visible until resolved. Workspace records currently have a 1 MB request limit; export large photo collections as a backup.

Run locally with Node.js 24 or newer:

    npm run dev

The local server creates a real SQLite database at .local/fieldshift.sqlite. This directory is ignored by Git. Production uses the Sites-managed D1 database and the SQL files in migrations/.

Google requires a Google Cloud OAuth web application registered by the site owner. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET as hosted runtime secrets. Register this exact redirect URI:

    https://fieldshift-nasa.ameer-prince.chatgpt.site/api/auth/google/callback

Deploy the saved site version again after changing hosted settings. Google stays visibly unavailable until both values are configured. OAuth uses PKCE and a state cookie, and requires a verified Google email. Existing password accounts are not silently linked to Google accounts with a matching email.

Email confirmation and password recovery email delivery are not included; no mail service is configured. Email/password registration is direct registration and does not claim that the address has been verified.

AI settings show the browser's reported quota and usage, and can request persistent storage. Browsers decide how much space they grant. Model files remain device-local; workspace records and chat history save with signed-in accounts. The current 5.8 GB Gemma model still needs suitable WebGPU hardware. Storage size alone does not increase model capability.
