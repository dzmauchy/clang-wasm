#!/usr/bin/env node
import { cleanLlvm } from "../src/utils/clean.js";

const rootDir = process.argv[2] || process.env.PROJECT_DIR || process.cwd();
cleanLlvm(rootDir);
