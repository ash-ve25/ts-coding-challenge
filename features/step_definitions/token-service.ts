import { Given, Then, When, setDefaultTimeout } from "@cucumber/cucumber";
import assert from "node:assert";
import {
  AccountBalanceQuery,
  ReceiptStatusError,
  Status,
  TokenAssociateTransaction,
  TokenCreateTransaction,
  TokenId,
  TokenInfo,
  TokenInfoQuery,
  TokenMintTransaction,
  TokenSupplyType,
  TokenType,
  Transaction,
  TransactionReceipt,
  TransferTransaction,
} from "@hashgraph/sdk";
import { hederaClient } from "../../src/utils/client";
import { AccountContext, ensureAccountBalance, getAccountContext } from "../../src/utils/accounts";

const client = hederaClient;
setDefaultTimeout(180 * 1000);

type TokenWorld = {
  account?: AccountContext;
  firstAccount?: AccountContext;
  secondAccount?: AccountContext;
  thirdAccount?: AccountContext;
  fourthAccount?: AccountContext;
  treasuryAccount?: AccountContext;
  tokenId?: TokenId;
  tokenDecimals?: number;
  tokenSupplyType?: TokenSupplyType;
  tokenInfoCache?: TokenInfo;
  pendingTransferMovements?: Array<{ account: AccountContext; units: number }>;
  pendingTransferPayer?: AccountContext;
  lastTransactionPayer?: AccountContext;
  lastTransactionReceipt?: TransactionReceipt;
};

const tokenWorld = (world: unknown): TokenWorld => world as TokenWorld;
const TOKEN_DECIMALS = 2;

const ensurePrimaryAccount = (world: TokenWorld): AccountContext => {
  if (!world.account) {
    world.account = getAccountContext(0, "primary account");
  }
  return world.account;
};

const ensureFirstAccount = (world: TokenWorld): AccountContext => {
  if (!world.firstAccount) {
    world.firstAccount = getAccountContext(0, "first account");
  }
  return world.firstAccount;
};

const ensureSecondAccount = (world: TokenWorld): AccountContext => {
  if (!world.secondAccount) {
    world.secondAccount = getAccountContext(1, "second account");
  }
  return world.secondAccount;
};

const ensureThirdAccount = (world: TokenWorld): AccountContext => {
  if (!world.thirdAccount) {
    world.thirdAccount = getAccountContext(2, "third account");
  }
  return world.thirdAccount;
};

const ensureFourthAccount = (world: TokenWorld): AccountContext => {
  if (!world.fourthAccount) {
    world.fourthAccount = getAccountContext(3, "fourth account");
  }
  return world.fourthAccount;
};

const ensureTreasuryAccount = (world: TokenWorld): AccountContext => {
  if (!world.treasuryAccount) {
    world.treasuryAccount = getAccountContext(4, "treasury account");
  }
  return world.treasuryAccount;
};

const requireTokenId = (world: TokenWorld): TokenId => {
  assert.ok(world.tokenId, "Token has not been created");
  return world.tokenId;
};

const decimalsMultiplier = (world: TokenWorld): number => Math.pow(10, world.tokenDecimals ?? TOKEN_DECIMALS);
const toTokenUnits = (world: TokenWorld, amount: number): number => Math.trunc(amount * decimalsMultiplier(world));
const fromTokenUnits = (world: TokenWorld, units: number): number => units / decimalsMultiplier(world);

const executeTransaction = async <T extends Transaction>(
  transaction: T,
  payer: AccountContext,
  signers: AccountContext[] = [],
): Promise<TransactionReceipt> => {
  client.setOperator(payer.id, payer.privateKey);
  const frozen = await transaction.freezeWith(client);
  const seen = new Set<string>();
  await frozen.sign(payer.privateKey);
  seen.add(payer.id.toString());
  for (const signer of signers) {
    const key = signer.id.toString();
    if (seen.has(key)) {
      continue;
    }
    await frozen.sign(signer.privateKey);
    seen.add(key);
  }
  const response = await frozen.execute(client);
  return await response.getReceipt(client);
};

const ensureTokenAssociation = async (world: TokenWorld, account: AccountContext): Promise<void> => {
  const tokenId = requireTokenId(world);
  try {
    await executeTransaction(
      new TokenAssociateTransaction().setAccountId(account.id).setTokenIds([tokenId]),
      account,
      [account],
    );
  } catch (error) {
    if (error instanceof ReceiptStatusError && error.status === Status.TokenAlreadyAssociatedToAccount) {
      return;
    }
    throw error;
  }
};

const getTokenBalanceUnits = async (world: TokenWorld, account: AccountContext): Promise<number> => {
  const tokenId = requireTokenId(world);
  client.setOperator(account.id, account.privateKey);
  const balance = await new AccountBalanceQuery().setAccountId(account.id).execute(client);
  const tokens = balance.tokens;
  if (!tokens) {
    return 0;
  }
  const value = tokens.get(tokenId) ?? tokens.get(tokenId.toString());
  if (!value) {
    return 0;
  }
  return typeof value === "number" ? value : value.toNumber();
};

const assertTokenBalance = async (world: TokenWorld, account: AccountContext, expected: number): Promise<void> => {
  const actualUnits = await getTokenBalanceUnits(world, account);
  assert.strictEqual(fromTokenUnits(world, actualUnits), expected, `${account.label} balance mismatch`);
};

const adjustHoldingFromTreasury = async (
  world: TokenWorld,
  account: AccountContext,
  targetTokens: number,
): Promise<void> => {
  const targetUnits = toTokenUnits(world, targetTokens);
  await ensureTokenAssociation(world, account);
  const currentUnits = await getTokenBalanceUnits(world, account);
  if (currentUnits === targetUnits) {
    return;
  }
  const treasury = ensureTreasuryAccount(world);
  await ensureTokenAssociation(world, treasury);
  if (currentUnits < targetUnits) {
    const diff = targetUnits - currentUnits;
    await submitTokenTransfer(world, [
      { account: treasury, units: -diff },
      { account, units: diff },
    ], treasury);
  } else {
    const diff = currentUnits - targetUnits;
    await submitTokenTransfer(world, [
      { account, units: -diff },
      { account: treasury, units: diff },
    ], account);
  }
};

const planTokenTransfer = (
  world: TokenWorld,
  movements: Array<{ account: AccountContext; units: number }>,
  payer: AccountContext,
): void => {
  const total = movements.reduce((sum, movement) => sum + movement.units, 0);
  assert.strictEqual(total, 0, "Token transfer must balance");
  world.pendingTransferMovements = movements;
  world.pendingTransferPayer = payer;
};

const submitTokenTransfer = async (
  world: TokenWorld,
  movements: Array<{ account: AccountContext; units: number }>,
  payer: AccountContext,
): Promise<void> => {
  const tokenId = requireTokenId(world);
  const transaction = new TransferTransaction();
  for (const movement of movements) {
    await ensureTokenAssociation(world, movement.account);
    transaction.addTokenTransfer(tokenId, movement.account.id, movement.units);
  }
  const signers = movements
    .filter((movement) => movement.units < 0 && movement.account.id.toString() !== payer.id.toString())
    .map((movement) => movement.account);
  const receipt = await executeTransaction(transaction, payer, signers);
  world.lastTransactionPayer = payer;
  world.lastTransactionReceipt = receipt;
};

const submitPendingTransfer = async (world: TokenWorld): Promise<void> => {
  assert.ok(world.pendingTransferMovements, "No transfer prepared");
  assert.ok(world.pendingTransferPayer, "Transfer payer not specified");
  await submitTokenTransfer(world, world.pendingTransferMovements, world.pendingTransferPayer);
  world.pendingTransferMovements = undefined;
  world.pendingTransferPayer = undefined;
};

interface TokenCreationOptions {
  name: string;
  symbol: string;
  decimals: number;
  initialSupply: number;
  maxSupply?: number;
  supplyType: TokenSupplyType;
  treasury: AccountContext;
}

const createToken = async (world: TokenWorld, options: TokenCreationOptions): Promise<void> => {
  const multiplier = Math.pow(10, options.decimals);
  const initialUnits = Math.trunc(options.initialSupply * multiplier);
  const maxUnits = options.maxSupply !== undefined ? Math.trunc(options.maxSupply * multiplier) : undefined;

  client.setOperator(options.treasury.id, options.treasury.privateKey);
  let transaction = new TokenCreateTransaction()
    .setTokenName(options.name)
    .setTokenSymbol(options.symbol)
    .setTokenType(TokenType.FungibleCommon)
    .setTreasuryAccountId(options.treasury.id)
    .setDecimals(options.decimals)
    .setInitialSupply(initialUnits)
    .setSupplyType(options.supplyType)
    .setSupplyKey(options.treasury.privateKey.publicKey)
    .setAdminKey(options.treasury.privateKey.publicKey);

  if (maxUnits !== undefined) {
    transaction = transaction.setMaxSupply(maxUnits);
  }

  const receipt = await (await transaction.execute(client)).getReceipt(client);
  assert.strictEqual(receipt.status, Status.Success, "Token creation failed");
  world.tokenId = receipt.tokenId ?? undefined;
  world.tokenDecimals = options.decimals;
  world.tokenSupplyType = options.supplyType;
  world.tokenInfoCache = undefined;
  world.treasuryAccount = options.treasury;
};

const ensureTokenInfo = async (world: TokenWorld): Promise<TokenInfo> => {
  const tokenId = requireTokenId(world);
  if (!world.tokenInfoCache) {
    const operator = world.treasuryAccount ?? ensurePrimaryAccount(world);
    client.setOperator(operator.id, operator.privateKey);
    world.tokenInfoCache = await new TokenInfoQuery().setTokenId(tokenId).execute(client);
  }
  return world.tokenInfoCache;
};

Given(/^A Hedera account with more than (\d+) hbar$/, async function (expectedBalance: number) {
  const world = tokenWorld(this);
  const account = ensurePrimaryAccount(world);
  await ensureAccountBalance(account, expectedBalance);
  world.treasuryAccount ??= account;
});

When(/^I create a token named Test Token \(HTT\)$/, async function () {
  const world = tokenWorld(this);
  const treasury = ensurePrimaryAccount(world);
  await createToken(world, {
    name: "Test Token",
    symbol: "HTT",
    decimals: TOKEN_DECIMALS,
    initialSupply: 0,
    supplyType: TokenSupplyType.Infinite,
    treasury,
  });
});

Then(/^The token has the name "([^"]*)"$/, async function (expectedName: string) {
  const world = tokenWorld(this);
  const info = await ensureTokenInfo(world);
  assert.strictEqual(info.name, expectedName);
});

Then(/^The token has the symbol "([^"]*)"$/, async function (expectedSymbol: string) {
  const world = tokenWorld(this);
  const info = await ensureTokenInfo(world);
  assert.strictEqual(info.symbol, expectedSymbol);
});

Then(/^The token has (\d+) decimals$/, async function (expectedDecimals: number) {
  const world = tokenWorld(this);
  const info = await ensureTokenInfo(world);
  assert.strictEqual(info.decimals, expectedDecimals);
});

Then(/^The token is owned by the account$/, async function () {
  const world = tokenWorld(this);
  const account = ensurePrimaryAccount(world);
  const info = await ensureTokenInfo(world);
  assert.strictEqual(info.treasuryAccountId?.toString(), account.id.toString());
});

Then(/^An attempt to mint (\d+) additional tokens succeeds$/, async function (amount: number) {
  const world = tokenWorld(this);
  const treasury = ensureTreasuryAccount(world);
  const receipt = await executeTransaction(
    new TokenMintTransaction().setTokenId(requireTokenId(world)).setAmount(toTokenUnits(world, amount)),
    treasury,
    [treasury],
  );
  assert.strictEqual(receipt.status, Status.Success, "Mint transaction failed");
  world.tokenInfoCache = undefined;
});

When(/^I create a fixed supply token named Test Token \(HTT\) with (\d+) tokens$/, async function (totalSupply: number) {
  const world = tokenWorld(this);
  const treasury = ensurePrimaryAccount(world);
  await createToken(world, {
    name: "Test Token",
    symbol: "HTT",
    decimals: TOKEN_DECIMALS,
    initialSupply: totalSupply,
    maxSupply: totalSupply,
    supplyType: TokenSupplyType.Finite,
    treasury,
  });
});

Then(/^The total supply of the token is (\d+)$/, async function (expectedSupply: number) {
  const world = tokenWorld(this);
  const info = await ensureTokenInfo(world);
  const totalUnits = typeof info.totalSupply === "number" ? info.totalSupply : info.totalSupply.toNumber();
  assert.strictEqual(fromTokenUnits(world, totalUnits), expectedSupply);
});

Then(/^An attempt to mint tokens fails$/, async function () {
  const world = tokenWorld(this);
  const treasury = ensureTreasuryAccount(world);
  await assert.rejects(async () => {
    await executeTransaction(
      new TokenMintTransaction().setTokenId(requireTokenId(world)).setAmount(toTokenUnits(world, 1)),
      treasury,
      [treasury],
    );
  }, (error: unknown) => error instanceof ReceiptStatusError && error.status === Status.TokenMaxSupplyReached);
});

Given(/^A first hedera account with more than (\d+) hbar$/, async function (expectedBalance: number) {
  const world = tokenWorld(this);
  const account = ensureFirstAccount(world);
  await ensureAccountBalance(account, expectedBalance);
});

Given(/^A second Hedera account$/, function () {
  const world = tokenWorld(this);
  ensureSecondAccount(world);
});

Given(/^A token named Test Token \(HTT\) with (\d+) tokens$/, async function (totalSupply: number) {
  const world = tokenWorld(this);
  const treasury = ensureTreasuryAccount(world);
  await createToken(world, {
    name: "Test Token",
    symbol: "HTT",
    decimals: TOKEN_DECIMALS,
    initialSupply: totalSupply,
    maxSupply: totalSupply,
    supplyType: TokenSupplyType.Finite,
    treasury,
  });
});

Given(/^The first account holds (\d+) HTT tokens$/, async function (amount: number) {
  const world = tokenWorld(this);
  const account = ensureFirstAccount(world);
  await adjustHoldingFromTreasury(world, account, amount);
});

Given(/^The second account holds (\d+) HTT tokens$/, async function (amount: number) {
  const world = tokenWorld(this);
  const account = ensureSecondAccount(world);
  await adjustHoldingFromTreasury(world, account, amount);
});

When(/^The first account creates a transaction to transfer (\d+) HTT tokens to the second account$/, function (amount: number) {
  const world = tokenWorld(this);
  const first = ensureFirstAccount(world);
  const second = ensureSecondAccount(world);
  const units = toTokenUnits(world, amount);
  planTokenTransfer(
    world,
    [
      { account: first, units: -units },
      { account: second, units: units },
    ],
    first,
  );
});

When(/^The first account submits the transaction$/, async function () {
  const world = tokenWorld(this);
  await submitPendingTransfer(world);
});

When(/^The second account creates a transaction to transfer (\d+) HTT tokens to the first account$/, function (amount: number) {
  const world = tokenWorld(this);
  const first = ensureFirstAccount(world);
  const second = ensureSecondAccount(world);
  const units = toTokenUnits(world, amount);
  planTokenTransfer(
    world,
    [
      { account: second, units: -units },
      { account: first, units: units },
    ],
    first,
  );
});

Then(/^The first account has paid for the transaction fee$/, function () {
  const world = tokenWorld(this);
  const first = ensureFirstAccount(world);
  assert.strictEqual(world.lastTransactionPayer?.id.toString(), first.id.toString(), "Fee payer mismatch");
});

Given(
  /^A first hedera account with more than (\d+) hbar and (\d+) HTT tokens$/,
  async function (expectedHbar: number, tokens: number) {
    const world = tokenWorld(this);
    const account = ensureFirstAccount(world);
    await ensureAccountBalance(account, expectedHbar);
    await adjustHoldingFromTreasury(world, account, tokens);
  },
);

Given(
  /^A second Hedera account with (\d+) hbar and (\d+) HTT tokens$/,
  async function (expectedHbar: number, tokens: number) {
    const world = tokenWorld(this);
    const account = ensureSecondAccount(world);
    await ensureAccountBalance(account, expectedHbar);
    await adjustHoldingFromTreasury(world, account, tokens);
  },
);

Given(
  /^A third Hedera account with (\d+) hbar and (\d+) HTT tokens$/,
  async function (expectedHbar: number, tokens: number) {
    const world = tokenWorld(this);
    const account = ensureThirdAccount(world);
    await ensureAccountBalance(account, expectedHbar);
    await adjustHoldingFromTreasury(world, account, tokens);
  },
);

Given(
  /^A fourth Hedera account with (\d+) hbar and (\d+) HTT tokens$/,
  async function (expectedHbar: number, tokens: number) {
    const world = tokenWorld(this);
    const account = ensureFourthAccount(world);
    await ensureAccountBalance(account, expectedHbar);
    await adjustHoldingFromTreasury(world, account, tokens);
  },
);

When(
  /^A transaction is created to transfer (\d+) HTT tokens out of the first and second account and (\d+) HTT tokens into the third account and (\d+) HTT tokens into the fourth account$/,
  function (outgoing: number, thirdIncoming: number, fourthIncoming: number) {
    const world = tokenWorld(this);
    const first = ensureFirstAccount(world);
    const second = ensureSecondAccount(world);
    const third = ensureThirdAccount(world);
    const fourth = ensureFourthAccount(world);
    const outUnits = toTokenUnits(world, outgoing);
    const thirdUnits = toTokenUnits(world, thirdIncoming);
    const fourthUnits = toTokenUnits(world, fourthIncoming);
    planTokenTransfer(
      world,
      [
        { account: first, units: -outUnits },
        { account: second, units: -outUnits },
        { account: third, units: thirdUnits },
        { account: fourth, units: fourthUnits },
      ],
      first,
    );
  },
);

Then(/^The third account holds (\d+) HTT tokens$/, async function (amount: number) {
  const world = tokenWorld(this);
  const account = ensureThirdAccount(world);
  await assertTokenBalance(world, account, amount);
});

Then(/^The fourth account holds (\d+) HTT tokens$/, async function (amount: number) {
  const world = tokenWorld(this);
  const account = ensureFourthAccount(world);
  await assertTokenBalance(world, account, amount);
});
