-- Local authentication (replaces Auth0):
-- users are identified by a generic subject and authenticate with a local password.

ALTER TABLE users RENAME COLUMN auth0_sub TO subject;
ALTER TABLE users ADD COLUMN password_hash VARCHAR(100);
