# Sessions last 400 days and are replaced only at login

A User stays logged in for 400 days, the longest a browser keeps a cookie, because the app lives on a phone's home screen and a Discogs login there is slow. The session token is never rotated while it is in use. Each login creates a new token and deletes the one the browser had, and logging out deletes it too. Expired sessions are deleted whenever someone logs in.

Rotating the token on a timer would shorten how long a stolen cookie works, but the cookie is HttpOnly, Secure in production and stored only as a hash, so theft needs the phone itself. Rotation would also add a race: two tabs or a slow network can send the old token after the new one was issued and log the User out. If a session is ever stolen, logging out on that phone or deleting the User's rows in `sessions` ends it.
