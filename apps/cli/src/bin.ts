#!/usr/bin/env node
import { main } from "./index.js";

main().then(
  (code) => {
    process.exit(code);
  },
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
