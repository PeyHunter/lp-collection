import { defineConfig } from "vitest/config";
import base from "../../vitest.config.ts";

// Runs one failing test through the real global setup, so CI can check that a failure exits non-zero.
export default defineConfig({ ...base, test: { ...base.test, include: ["test/exit-code/always-fails.ts"] } });
