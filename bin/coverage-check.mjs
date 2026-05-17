#!/usr/bin/env node
import { main } from "../dist/src/cli.mjs";
/* c8 ignore next */
process.exit(await main(process.argv.slice(2)));
