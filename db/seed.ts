import { drizzle } from "drizzle-orm/mysql2";
import { createPool } from "mysql2/promise";
import { users } from "./schema";
import bcrypt from "bcryptjs";
import * as schema from "./schema";
import * as relations from "./relations";
import dotenv from "dotenv";

dotenv.config();

async function seed() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL not set");
    process.exit(1);
  }

  const pool = createPool(process.env.DATABASE_URL);
  const db = drizzle(pool, { mode: "planetscale", schema: { ...schema, ...relations } });

  const existing = await db.query.users.findFirst({
    where: (u, { eq }) => eq(u.username, "admin"),
  });

  if (!existing) {
    const hash = await bcrypt.hash("admin", 10);
    await db.insert(users).values({
      username: "admin",
      passwordHash: hash,
      name: "系统管理员",
      role: "admin",
      isActive: true,
    });
    console.log("Admin user created: admin / admin");
  } else {
    console.log("Admin user already exists");
  }

  await pool.end();
  process.exit(0);
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
