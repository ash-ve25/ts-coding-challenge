# The Hashgraph Group (THG) Coding Task

## Getting Started

### Installation Steps

1. Clone your fork of this repository.
2. From the project root, run `corepack enable` (first time only).
3. Install dependencies with `pnpm install`.
4. Edit `src/config.ts` so each `Account` entry matches a real testnet account and private key under your control.

## Running the Tests

1. Ensure the accounts listed in `src/config.ts` have more than the balances required by each scenario (typically >10 ℏ).
2. Choose the appropriate script:
   - `pnpm test` — Runs the entire suite using the `cucumber.js` default profile.
   - `pnpm test:dev` — Executes only scenarios tagged `@dev` (currently the consensus flow).
   - `pnpm test:wip` — Executes scenarios tagged `not @wip`, convenient for smoke tests while iterating.
   - Custom tags — Use `cucumber-js -p default --tags '@yourTag and not @wip' --exit` to target arbitrary subsets.
3. Watch the console for progress-bar output. On failure, Cucumber surfaces the exact step plus the underlying TypeScript stack trace; open the matching file under `features/step_definitions/` to debug.

## Scenario Coverage

- **Consensus service** (`features/consensus.feature`): creates topics, optionally with 1-of-2 threshold submit keys, publishes messages, and confirms delivery through live subscriptions.
- **Token service** (`features/tokens.feature`): walks through mintable and fixed-supply token creation, treasury ownership checks, single-/multi-party transfers, payer-swapped fees, and mint failure paths.

## Folder Structure

- `features/` — Gherkin feature files (`tokens.feature`, `consensus.feature`) that define expected behaviors.
- `features/step_definitions/` — TypeScript step implementations (`token-service.ts`, `create-simple-topic.ts`) that drive Hedera SDK calls.
- `src/config.ts` — List of testnet accounts and keys consumed by the step layers.
- `src/utils/` — Shared helpers (`client.ts`, `accounts.ts`) for client instantiation, account lookup, and balance checks.
- `src/create-accounts.ts` — Optional script for provisioning additional actors.
- `task/` — Challenge brief/materials (read-only during implementation).
- `cucumber.js` — Centralizes cucumber options used by every npm script.
- `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `tsconfig.json` — Toolchain metadata.

## Credits

Ashish Verma
