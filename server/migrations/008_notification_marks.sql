-- One notification marked read or unread by hand, against the account's "seen up to".
create table notification_marks (
  login text not null,
  id text not null,
  read boolean not null,
  primary key (login, id)
);
