-- What each GitHub account chose for itself: the site's language, which its notifications use too.
create table user_settings (
  login text primary key,
  lang text not null
);
