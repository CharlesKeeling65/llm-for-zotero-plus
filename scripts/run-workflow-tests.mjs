import { spawn } from "node:child_process";

const command = process.platform === "win32" ? "npx.cmd" : "npx";
const args = ["zotero-plugin", "test", "--no-watch", "--abort-on-fail"];

const child = spawn(command, args, {
  stdio: "inherit",
  env: {
    ...process.env,
    NODE_ENV: "test",
    LLM_FOR_ZOTERO_WORKFLOW_TESTS: "1",
  },
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`Workflow tests terminated by ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
