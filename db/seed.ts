import { getDb } from "../api/queries/connection";

async function seed() {
  // Opens (and creates or migrates) the database file; that is all this script
  // does until it has rows to insert.
  getDb();
  console.log("Seeding database...");

  // TODO: insert seed data, e.g.
  // await getDb().insert(schema.files).values([
  //   { key: "example-key", ownerId: 1, name: "example.png", size: 1024 },
  // ]);

  console.log("Done.");
  process.exit(0);
}

seed();
