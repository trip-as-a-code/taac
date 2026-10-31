-- How far each GitHub account has read its notifications.
create table notification_reads (
  login text primary key,
  seen_at bigint not null
);
