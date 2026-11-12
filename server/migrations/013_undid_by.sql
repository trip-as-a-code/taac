-- On an untick, who had made the tick it took back: an untick shows only when
-- someone took back another's tick.
alter table packing_ticks add column undid_login text;
