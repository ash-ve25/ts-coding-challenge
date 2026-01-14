import { Given, Then, When, setDefaultTimeout } from "@cucumber/cucumber";
import assert from "node:assert";
import { KeyList, Status, TopicCreateTransaction, TopicId, TopicMessageQuery, TopicMessageSubmitTransaction } from "@hashgraph/sdk";
import { hederaClient } from "../../src/utils/client";
import { AccountContext, ensureAccountBalance, getAccountContext } from "../../src/utils/accounts";

type TopicWorld = {
  firstAccount?: AccountContext;
  secondAccount?: AccountContext;
  thresholdKey?: KeyList;
  topicId?: TopicId;
  lastPublishedMessage?: string;
  messageQueryStart?: Date;
};

const client = hederaClient;
setDefaultTimeout(120 * 1000);

const topicWorld = (world: unknown): TopicWorld => world as TopicWorld;

const ensureFirstAccount = (world: TopicWorld): AccountContext => {
  if (!world.firstAccount) {
    world.firstAccount = getAccountContext(0, "first Hedera account");
  }
  return world.firstAccount;
};

const ensureSecondAccount = (world: TopicWorld): AccountContext => {
  if (!world.secondAccount) {
    world.secondAccount = getAccountContext(1, "second Hedera account");
  }
  return world.secondAccount;
};

Given(/^a first account with more than (\d+) hbars$/, async function (expectedBalance: number) {
  const world = topicWorld(this);
  const account = ensureFirstAccount(world);
  await ensureAccountBalance(account, expectedBalance);
});

When(/^A topic is created with the memo "([^"]*)" with the first account as the submit key$/, async function (memo: string) {
  const world = topicWorld(this);
  const account = ensureFirstAccount(world);
  client.setOperator(account.id, account.privateKey);

  const response = await new TopicCreateTransaction()
    .setTopicMemo(memo)
    .setSubmitKey(account.privateKey.publicKey)
    .execute(client);

  const receipt = await response.getReceipt(client);
  assert.strictEqual(receipt.status, Status.Success, "Topic creation failed");
  world.topicId = receipt.topicId ?? undefined;
});

When(/^The message "([^"]*)" is published to the topic$/, async function (message: string) {
  const world = topicWorld(this);
  const account = ensureFirstAccount(world);
  assert.ok(world.topicId, "Topic has not been created");

  client.setOperator(account.id, account.privateKey);
  world.messageQueryStart = new Date(Date.now() - 1_000);

  const response = await new TopicMessageSubmitTransaction()
    .setTopicId(world.topicId as TopicId)
    .setMessage(message)
    .execute(client);

  const receipt = await response.getReceipt(client);
  assert.strictEqual(receipt.status, Status.Success, "Message submission failed");
  world.lastPublishedMessage = message;
  if (receipt.topicSequenceNumber && typeof receipt.topicSequenceNumber.toNumber === "function") {
    console.log(
      `Message "${message}" submitted to topic ${world.topicId?.toString()} (#${receipt.topicSequenceNumber.toNumber()})`,
    );
  }
});

Then(/^The message "([^"]*)" is received by the topic and can be printed to the console$/, async function (message: string) {
  const world = topicWorld(this);
  assert.ok(world.topicId, "Topic is not available");
  const startTime = world.messageQueryStart ?? new Date(Date.now() - 5_000);

  await new Promise<void>((resolve, reject) => {
    const subscription = new TopicMessageQuery()
      .setTopicId(world.topicId as TopicId)
      .setStartTime(startTime)
      .subscribe(
        client,
        (_, error) => {
          subscription.unsubscribe();
          reject(error);
        },
        (topicMessage) => {
          const contents = Buffer.from(topicMessage.contents).toString("utf8");
          if (contents === message) {
            console.log(`Topic ${world.topicId?.toString()} received message "${contents}"`);
            subscription.unsubscribe();
            resolve();
          }
        },
      );

    setTimeout(() => {
      subscription.unsubscribe();
      reject(new Error("Timed out waiting for topic message"));
    }, 20_000);
  });
});

Given(/^A second account with more than (\d+) hbars$/, async function (expectedBalance: number) {
  const world = topicWorld(this);
  const account = ensureSecondAccount(world);
  await ensureAccountBalance(account, expectedBalance);
});

Given(/^A (\d+) of (\d+) threshold key with the first and second account$/, function (threshold: number, total: number) {
  const world = topicWorld(this);
  const first = ensureFirstAccount(world);
  const second = ensureSecondAccount(world);
  assert.strictEqual(total, 2, "This scenario requires two keys");
  assert.ok(threshold >= 1 && threshold <= total, "Invalid threshold configuration");

  const keyList = new KeyList([first.privateKey.publicKey, second.privateKey.publicKey]);
  keyList.setThreshold(threshold);
  world.thresholdKey = keyList;
});

When(/^A topic is created with the memo "([^"]*)" with the threshold key as the submit key$/, async function (memo: string) {
  const world = topicWorld(this);
  const account = ensureFirstAccount(world);
  assert.ok(world.thresholdKey, "Threshold key has not been defined");

  client.setOperator(account.id, account.privateKey);
  const response = await new TopicCreateTransaction()
    .setTopicMemo(memo)
    .setSubmitKey(world.thresholdKey)
    .execute(client);

  const receipt = await response.getReceipt(client);
  assert.strictEqual(receipt.status, Status.Success, "Topic creation with threshold key failed");
  world.topicId = receipt.topicId ?? undefined;
});
