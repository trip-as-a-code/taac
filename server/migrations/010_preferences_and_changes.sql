-- Notification kinds an account turned off; a setting row may now hold that alone.
alter table user_settings alter column lang drop not null;
alter table user_settings add column muted text[] not null default '{}';

-- Trip changes already announced, so a restart or a redeploy tells each one once.
create table announced_changes (
  trip text not null,
  id text not null,
  primary key (trip, id)
);
