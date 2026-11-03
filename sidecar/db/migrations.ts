// The schema, as the ordered list of migrations openDb applies. Append only: a shipped migration never changes.

export const MIGRATIONS: string[] = [
  `
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE providers (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    base_url TEXT NOT NULL DEFAULT '',
    api_key TEXT NOT NULL DEFAULT '',
    headers TEXT NOT NULL DEFAULT '{}',
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE models (
    provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    name TEXT NOT NULL,
    context_window INTEGER NOT NULL DEFAULT 128000,
    max_tokens INTEGER NOT NULL DEFAULT 16384,
    reasoning INTEGER NOT NULL DEFAULT 0,
    vision INTEGER NOT NULL DEFAULT 0,
    cost_input REAL NOT NULL DEFAULT 0,
    cost_output REAL NOT NULL DEFAULT 0,
    cost_cache_read REAL NOT NULL DEFAULT 0,
    cost_cache_write REAL NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    sort INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (provider_id, id)
  );
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    cwd TEXT NOT NULL,
    provider_id TEXT NOT NULL DEFAULT '',
    model_id TEXT NOT NULL DEFAULT '',
    thinking TEXT NOT NULL DEFAULT 'medium',
    permission_mode TEXT NOT NULL DEFAULT 'default',
    pinned INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    kind TEXT NOT NULL DEFAULT 'main',
    parent_id TEXT,
    status TEXT NOT NULL DEFAULT 'idle',
    todos TEXT NOT NULL DEFAULT '[]',
    usage_input INTEGER NOT NULL DEFAULT 0,
    usage_output INTEGER NOT NULL DEFAULT 0,
    usage_cache_read INTEGER NOT NULL DEFAULT 0,
    usage_cache_write INTEGER NOT NULL DEFAULT 0,
    usage_cost REAL NOT NULL DEFAULT 0,
    context_tokens INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX sessions_updated ON sessions(updated_at DESC);
  CREATE TABLE messages (
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    role TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (session_id, seq)
  );
  CREATE TABLE compactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    cut_seq INTEGER NOT NULL,
    summary TEXT NOT NULL,
    tokens_before INTEGER NOT NULL DEFAULT 0,
    auto INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE usage_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    model_id TEXT NOT NULL,
    input INTEGER NOT NULL,
    output INTEGER NOT NULL,
    cache_read INTEGER NOT NULL,
    cache_write INTEGER NOT NULL,
    cost REAL NOT NULL,
    purpose TEXT NOT NULL DEFAULT 'chat',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX usage_events_time ON usage_events(created_at);
  CREATE TABLE tool_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    is_error INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX tool_events_time ON tool_events(created_at);
  CREATE TABLE mcp_servers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    transport TEXT NOT NULL,
    command TEXT NOT NULL DEFAULT '',
    args TEXT NOT NULL DEFAULT '[]',
    env TEXT NOT NULL DEFAULT '{}',
    url TEXT NOT NULL DEFAULT '',
    headers TEXT NOT NULL DEFAULT '{}',
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE permission_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tool TEXT NOT NULL,
    pattern TEXT NOT NULL,
    decision TEXT NOT NULL,
    scope TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE VIRTUAL TABLE messages_fts USING fts5(text, session_id UNINDEXED, seq UNINDEXED, role UNINDEXED, tokenize = 'trigram');
  `,
  `
  UPDATE sessions SET permission_mode = CASE permission_mode WHEN 'plan' THEN 'manual' WHEN 'default' THEN 'whitelist' ELSE permission_mode END;
  DROP TABLE IF EXISTS permission_rules;
  `,
  `
  CREATE TABLE devices (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
  );
  `,
  `
  UPDATE sessions SET permission_mode = 'auto' WHERE permission_mode = 'whitelist';
  `,
  `
  ALTER TABLE models ADD COLUMN efforts TEXT;
  ALTER TABLE models ADD COLUMN effort_default TEXT;
  ALTER TABLE models ADD COLUMN locked TEXT NOT NULL DEFAULT '';
  `,
  `CREATE TABLE memory_jobs (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL, message TEXT NOT NULL, epoch TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
    error TEXT, created_at INTEGER NOT NULL, next_at INTEGER NOT NULL DEFAULT 0
  );`,
  `ALTER TABLE memory_jobs ADD COLUMN plan TEXT;
   CREATE INDEX memory_jobs_pending ON memory_jobs(state, next_at, created_at);`,
  `UPDATE providers SET kind = 'amazon-q',
     name = CASE WHEN name = 'Kiro' THEN 'Amazon Q' ELSE name END
   WHERE kind = 'kiro';`,
  `ALTER TABLE models ADD COLUMN metadata_source TEXT NOT NULL DEFAULT 'catalog';
   ALTER TABLE models ADD COLUMN metadata TEXT;`,
  `ALTER TABLE sessions ADD COLUMN fork_of TEXT;
   ALTER TABLE sessions ADD COLUMN fork_seq INTEGER;
   ALTER TABLE sessions ADD COLUMN merged_into TEXT;`,
  `CREATE TABLE pending_questions (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    owner_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    request TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending', answers TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX pending_questions_session ON pending_questions(session_id, state);
  CREATE TABLE merge_jobs (
    id TEXT PRIMARY KEY, source_id TEXT NOT NULL, target_id TEXT NOT NULL,
    state TEXT NOT NULL, instructions TEXT, snapshot TEXT, summary TEXT, error TEXT,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX merge_source_active ON merge_jobs(source_id)
    WHERE state IN ('queued', 'running', 'ready');`,
];
