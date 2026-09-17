import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const email = (process.env.SEED_SUPER_ADMIN_EMAIL ?? "admin@radx.app").toLowerCase();
  const password = process.env.SEED_SUPER_ADMIN_PASSWORD ?? "ChangeMe123!";
  const name = process.env.SEED_SUPER_ADMIN_NAME ?? "Rei Super Admin";

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.upsert({
    where: { email },
    update: { role: "SUPER_ADMIN", status: "ACTIVE", name },
    create: { email, name, passwordHash, role: "SUPER_ADMIN", status: "ACTIVE" },
    select: { id: true, email: true, role: true },
  });

  console.log(`Seeded ${user.role}: ${user.email}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
