CREATE TABLE IF NOT EXISTS store_entries (
  store TEXT NOT NULL,
  id    TEXT NOT NULL,
  data  TEXT NOT NULL,
  PRIMARY KEY (store, id)
);
