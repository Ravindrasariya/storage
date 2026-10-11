// Fail before importing routes or opening a database connection.
export function requireDevelopmentFixtures() {
  if (process.env.NODE_ENV !== "development") {
    throw new Error("Synthetic checks require NODE_ENV=development and the development database; never run against production.");
  }
  if (!process.env.DATABASE_URL) {
    throw new Error("Synthetic checks require the configured development DATABASE_URL.");
  }
  // Pin to this workspace's local Helium development endpoint. Do not accept
  // remote hosts, arbitrary databases, or connection-string query overrides.
  // NODE_ENV is deliberately not the database trust boundary.
  let target: URL;
  try {
    target = new URL(process.env.DATABASE_URL);
  } catch {
    throw new Error("Synthetic checks require a valid development database connection string.");
  }
  if (
    process.env.REPLIT_DEPLOYMENT === "1" ||
    !/^[a-z0-9.-]+\.replit\.dev$/i.test(process.env.REPLIT_DEV_DOMAIN ?? "") ||
    !["postgres:", "postgresql:"].includes(target.protocol) ||
    target.hostname !== "helium" ||
    target.pathname !== "/heliumdb" ||
    (target.port !== "" && target.port !== "5432") ||
    target.hash !== "" ||
    [...target.searchParams.keys()].some(key => key !== "sslmode") ||
    [...target.searchParams.values()].some(value => !["disable", "prefer", "require"].includes(value))
  ) {
    throw new Error("Synthetic checks are restricted to the Replit workspace Helium development database; remote/production targets and connection overrides are forbidden.");
  }
}
