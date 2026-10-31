-- Browsers that asked for notifications: where to push, and for whom.
create table push_subscriptions (
  endpoint text primary key,
  login text not null,
  p256dh text not null,
  auth text not null,
  lang text not null,
  created_at bigint not null
);
create index push_subscriptions_login on push_subscriptions (login);
