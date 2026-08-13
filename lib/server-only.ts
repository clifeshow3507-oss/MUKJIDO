import "server-only";

// Import this module from adapters that may handle credentials. Next.js rejects
// client-component import chains that include this marker; Vitest aliases it to
// Next's no-op test implementation.
