#!/usr/bin/env node

// Production entry point. The measured prototype and migration intentionally
// share one implementation so their retention policies cannot drift.
import "./prototype-compact-counterparty-bitcoin-index.mjs";
