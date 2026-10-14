import { defineConfig } from "drizzle-kit";
import path from "node:path";

// Loads DATABASE_URL from the .env file in the project root when it is not already set.
try {
  process.loadEnvFile(path.resolve(process.cwd(), "..", "..", ".env"));
} catch {
  // No .env file: rely on the real environment.
}

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env and fill it in.");
}

export default defineConfig({
  schema: path.resolve(process.cwd(), "src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
