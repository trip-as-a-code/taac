-- GitHub pictures by lowercase login; a null image is a default identicon, or no account.
create table avatars (
  login text primary key,
  type text,
  image bytea,
  fetched_at bigint not null
);
