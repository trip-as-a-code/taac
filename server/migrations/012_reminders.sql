-- Where each account is and when it wants reminders, and the latest reminder each person got of each thing due.
alter table user_settings add column time_zone text, add column remind_at text;
create table deadline_reminders (
  login text not null,
  -- `<trip>/<deadline key>`.
  key text not null,
  date text not null,
  rung integer not null,
  sent_at bigint not null,
  primary key (login, key)
);
