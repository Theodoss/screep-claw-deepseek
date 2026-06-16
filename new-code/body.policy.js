const SOURCE_ENERGY_PER_TICK = 10;
const CARRY_CAPACITY_PER_PART = 50;
const HAULER_SET_COST = 200;
const HAULER_SET_PARTS = 4;
const CARRIES_PER_HAULER_SET = 3;
const HAULER_THROUGHPUT_MARGIN = 1.1;
const MIN_HAULER_CARRY_PARTS = 12;
const DEFAULT_SOURCE_DISTANCE = 10;

function getBodyCost(body) {
  return body.reduce(
    (total, part) => total + (BODYPART_COST[part] || 0),
    0
  );
}

function buildStaticUpgraderBody(energyCapacity, desiredWork) {
  // Upgraders feed from a nearby controller container (1-tile trip).
  // Maximize WORK; just 1 CARRY + 1 MOVE is enough. Extra CARRY/MOVE
  // wastes energy that could go into more WORK parts.
  const affordableWork = Math.max(
    1,
    Math.floor(
      (energyCapacity - BODYPART_COST[CARRY] - BODYPART_COST[MOVE]) /
      BODYPART_COST[WORK]
    )
  );
  const workParts = Math.min(48, affordableWork, desiredWork || 1);

  const body = [];
  for (let index = 0; index < workParts; index++) body.push(WORK);
  body.push(CARRY, MOVE);
  return body;
}

function getRequiredHaulerCarryParts(sourceEntries) {
  let energyInTransit = 0;

  for (const sourceEntry of sourceEntries || []) {
    const oneWayDistance =
      typeof sourceEntry.haulingDistance === 'number'
        ? sourceEntry.haulingDistance
        : typeof sourceEntry.distanceFromSpawn === 'number'
          ? sourceEntry.distanceFromSpawn
        : DEFAULT_SOURCE_DISTANCE;
    const roundTripTicks = Math.max(2, oneWayDistance * 2 + 2);
    energyInTransit += roundTripTicks * SOURCE_ENERGY_PER_TICK;
  }

  return Math.max(
    2,
    Math.ceil(energyInTransit / CARRY_CAPACITY_PER_PART)
  );
}

function getMaxHaulerCarryParts(energyCapacity) {
  const affordableSets = Math.max(
    1,
    Math.floor(energyCapacity / HAULER_SET_COST)
  );
  const maxSets = Math.floor(50 / HAULER_SET_PARTS);
  return Math.min(affordableSets, maxSets) * CARRIES_PER_HAULER_SET;
}

function getHaulerPlan(
  energyCapacity,
  sourceEntries,
  minimumCount,
  backlogBonus
) {
  const requiredCarryParts = getRequiredHaulerCarryParts(sourceEntries);
  const maxCarryParts = getMaxHaulerCarryParts(energyCapacity);
  const bufferedCarryParts = Math.ceil(
    requiredCarryParts * HAULER_THROUGHPUT_MARGIN
  );
  const throughputCount = Math.max(
    1,
    Math.ceil(bufferedCarryParts / maxCarryParts)
  );
  const targetCount = Math.max(
    1,
    Math.ceil(minimumCount || 1),
    throughputCount
  ) + Math.max(0, Math.floor(backlogBonus || 0));
  const minimumCarryPartsPerHauler = Math.min(
    MIN_HAULER_CARRY_PARTS,
    maxCarryParts
  );
  const targetCarryParts = Math.max(
    bufferedCarryParts,
    targetCount * minimumCarryPartsPerHauler
  );
  const carryPartsPerHauler = Math.ceil(
    targetCarryParts / targetCount
  );
  const desiredSets = Math.max(1, Math.ceil(carryPartsPerHauler / CARRIES_PER_HAULER_SET));
  const sets = Math.min(desiredSets, maxCarryParts / CARRIES_PER_HAULER_SET);
  const body = [];

  for (let index = 0; index < sets; index++) {
    body.push(CARRY, CARRY, CARRY, MOVE);
  }

  return {
    body: body,
    bodyCost: getBodyCost(body),
    bodyCarryParts: sets * CARRIES_PER_HAULER_SET,
    maxCarryParts: maxCarryParts,
    requiredCarryParts: requiredCarryParts,
    targetCarryParts: targetCarryParts,
    targetCount: targetCount,
    throughputCount: throughputCount
  };
}

module.exports = {
  buildStaticUpgraderBody: buildStaticUpgraderBody,
  getBodyCost: getBodyCost,
  getHaulerPlan: getHaulerPlan,
  getMaxHaulerCarryParts: getMaxHaulerCarryParts,
  getRequiredHaulerCarryParts: getRequiredHaulerCarryParts
};
