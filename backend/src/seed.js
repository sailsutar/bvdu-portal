import "./loadEnv.js";
import { connectMongo, seedIfEmpty, User } from "./db.js";

async function main() {
  await connectMongo();
  const result = await seedIfEmpty();
  const total = await User.countDocuments();
  console.log(JSON.stringify({ ...result, totalUsers: total }, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
