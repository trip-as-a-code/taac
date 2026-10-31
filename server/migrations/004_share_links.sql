-- View-only links: anyone holding one sees its trip, read-only, until it expires or a member revokes it.
create table share_links (
  id text primary key,
  trip text not null,
  token text not null unique,
  label text not null default '',
  created_by text not null,
  created_at bigint not null,
  -- Null: never expires.
  expires_at bigint,
  revoked_at bigint,
  revoked_by text,
  last_used_at bigint
);
create index share_links_trip on share_links (trip);
