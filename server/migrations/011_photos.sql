-- Places' photos, fetched from wherever the trip points and kept resized, by photo id and size.
create table photos (
  id text not null,
  size text not null,
  type text not null,
  image bytea not null,
  fetched_at bigint not null,
  primary key (id, size)
);
