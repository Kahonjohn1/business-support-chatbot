import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";

import type { IntegrationConnectionFilter } from "../src/lib/integrations/repository.ts";
import {
  installIntegrationRepository,
  resetIntegrationTestRepository,
  seedIntegrationConnection,
} from "./integrationRepositoryStub.ts";

const FILTER_A: IntegrationConnectionFilter = {
  userId: "user-a",
  scope: "workspace",
  workspaceId: "workspace-1",
};

const FILTER_B: IntegrationConnectionFilter = {
  userId: "user-b",
  scope: "workspace",
  workspaceId: "workspace-1",
};

let repository: ReturnType<typeof installIntegrationRepository>;

beforeEach(() => {
  repository = installIntegrationRepository();
});

afterEach(() => {
  resetIntegrationTestRepository();
});

test("workspace connections are visible only to the member who connected them", async () => {
  const ownedByA = seedIntegrationConnection(repository, {
    userId: FILTER_A.userId,
    workspaceId: FILTER_A.workspaceId,
    provider: "gmail",
    encryptedAccessToken: "encrypted-a",
  });
  seedIntegrationConnection(repository, {
    userId: FILTER_B.userId,
    workspaceId: FILTER_B.workspaceId,
    provider: "gmail",
    encryptedAccessToken: "encrypted-b",
  });

  assert.deepEqual(
    (await repository.listConnections(FILTER_A)).map((record) => record.id),
    [ownedByA.id]
  );
  const ownedByB = await repository.findConnection(FILTER_B, "gmail");
  assert.equal(ownedByB?.ownerUserId, FILTER_B.userId);
});

test("one member cannot disconnect another member's connection", async () => {
  const ownedByA = seedIntegrationConnection(repository, {
    userId: FILTER_A.userId,
    workspaceId: FILTER_A.workspaceId,
    provider: "gmail",
    encryptedAccessToken: "encrypted-a",
  });

  await repository.deleteConnection(FILTER_B, ownedByA.id);

  assert.equal(repository.connections.length, 1);
  assert.equal(repository.connections[0]?.ownerUserId, FILTER_A.userId);
});
