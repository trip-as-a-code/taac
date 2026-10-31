-- Packing ticks: one person and one item per trip, the latest stamp wins.
create table packing_ticks (
  trip text not null,
  item text not null,
  member text not null,
  packed boolean not null,
  at bigint not null,
  primary key (trip, item, member)
);
