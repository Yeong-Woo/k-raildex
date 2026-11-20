-- 0010 계획 시간표 (docs/03-data-model.md 4-17절). 04시 이전은 24~27시(1440~1679분)

CREATE TABLE timetable_set (
  id text PRIMARY KEY,
  station_id text NOT NULL REFERENCES station(id) ON UPDATE CASCADE,
  line_station_id text REFERENCES line_station(id) ON UPDATE CASCADE,
  service_id text REFERENCES service(id) ON UPDATE CASCADE,
  route_code text NOT NULL,
  day_type text NOT NULL,
  direction text NOT NULL,
  direction_label text,
  day_note text,
  data_as_of text,
  source_id text NOT NULL REFERENCES source(id) ON UPDATE CASCADE,
  import_run_id bigint,
  CONSTRAINT timetable_set_id_chk CHECK (id ~ '^tt-[a-z0-9-]+$'),
  CONSTRAINT timetable_set_day_type_chk CHECK (day_type IN ('weekday', 'saturday', 'holiday')),
  CONSTRAINT timetable_set_direction_chk CHECK (direction IN ('up', 'down', 'inner', 'outer', 'unknown')),
  UNIQUE (station_id, route_code, day_type, direction)
);

CREATE INDEX timetable_set_ls_idx ON timetable_set (line_station_id);

CREATE TABLE timetable_entry (
  set_id text REFERENCES timetable_set(id) ON DELETE CASCADE ON UPDATE CASCADE,
  minute smallint NOT NULL CHECK (minute BETWEEN 0 AND 1679),
  dest_name text,
  dest_station_id text REFERENCES station(id) ON UPDATE CASCADE,
  train_no text NOT NULL DEFAULT '',
  note text,
  PRIMARY KEY (set_id, minute, train_no)
);
