import assert from "node:assert";
import { AccountBalanceQuery, AccountId, PrivateKey } from "@hashgraph/sdk";

import { accounts } from "../config";
import { hederaClient } from "./client";

export type AccountContext = {
  id: AccountId;
  privateKey: PrivateKey;
  label: string;
};

export const getAccountContext = (index: number, label: string): AccountContext => {
  const account = accounts[index];
  assert.ok(account, `Account #${index + 1} is not configured`);
  return {
    id: AccountId.fromString(account.id),
    privateKey: PrivateKey.fromStringED25519(account.privateKey),
    label,
  };
};

export const ensureAccountBalance = async (account: AccountContext, expectedBalance: number): Promise<void> => {
  hederaClient.setOperator(account.id, account.privateKey);
  const balance = await new AccountBalanceQuery().setAccountId(account.id).execute(hederaClient);
  assert.ok(
    balance.hbars.toBigNumber().toNumber() > expectedBalance,
    `${account.label} does not have the expected balance`,
  );
};
