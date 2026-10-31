-- Discussion threads, anchored anywhere on a trip (`trip`, `day:2026-12-11`, an item's id, …); flat replies.
create table threads (
  id text primary key,
  trip text not null,
  anchor text not null,
  created_by text not null,
  created_at bigint not null,
  resolved_at bigint,
  resolved_by text
);
create index threads_trip on threads (trip);

create table comments (
  id text primary key,
  thread_id text not null references threads (id) on delete cascade,
  author text not null,
  body text not null,
  created_at bigint not null,
  edited_at bigint,
  -- A deleted comment keeps its place in the thread; its text is gone.
  deleted_at bigint
);
create index comments_thread on comments (thread_id, created_at);
