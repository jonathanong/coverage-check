#!/usr/bin/env -S node --experimental-strip-types --no-warnings

import { main } from "../src/cli.mts";

/* c8 ignore next */
process.exit(await main(process.argv.slice(2)));
