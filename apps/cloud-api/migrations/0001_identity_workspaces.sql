-- ORBIT cloud identity and tenant boundary foundation.
-- Data is isolated by workspace membership; never query workspace data without identity_sub.
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 80),
  workspace_key TEXT NOT NULL CHECK (length(workspace_key) BETWEEN 1 AND 48),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(created_by, workspace_key)
);

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  identity_sub TEXT NOT NULL,
  email TEXT,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (workspace_id, identity_sub)
);

CREATE INDEX IF NOT EXISTS workspace_members_identity_idx
  ON workspace_members(identity_sub, workspace_id);

