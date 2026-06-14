const SOURCE_ENERGY_PER_TICK = 10;
const CARRY_CAPACITY_PER_PART = 50;
const HAULER_SET_COST = 150;
const HAULER_SET_PARTS = 3;
const DEFAULT_SOURCE_DISTANCE = 10;

function getBodyCost(body) {
  return body.reduce(
    (total, part) => total + (BODYPART_COST[part] || 0),
    0
  );
}

function buildStaticUpgraderBody(energyCapacity, desiredWork) {
  const body = [];
  const affordableWork = Math.max(
    1,
    Math.floor(
      (energyCapacity - BODYPART_COST[CARRY] - BODYPART_COST[MOVE]) /
      BODYPART_COST[WORK]
    )
  );
  const workParts = Math.min(48, affordableWork, desiredWork || 1);

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
  return Math.min(affordableSets, maxSets) * 2;
}

function getHaulerPlan(
  energyCapacity,
  sourceEntries,
  minimumCount,
  backlogBonus
) {
  const requiredCarryParts = getRequiredHaulerCarryParts(sourceEntries);
  const maxCarryParts = getMaxHaulerCarryParts(energyCapacity);
  const throughputCount = Math.max(
    1,
    Math.ceil(requiredCarryParts / maxCarryParts)
  );
  const targetCount = Math.max(
    1,
    Math.ceil(minimumCount || 1),
    throughputCount
  ) + Math.max(0, Math.floor(backlogBonus || 0));
  const carryPartsPerHauler = Math.ceil(
    requiredCarryParts / targetCount
  );
  const desiredSets = Math.max(1, Math.ceil(carryPartsPerHauler / 2));
  const sets = Math.min(desiredSets, maxCarryParts / 2);
  const body = [];

  for (let index = 0; index < sets; index++) {
    body.push(CARRY, CARRY, MOVE);
  }

  return {
    body: body,
    bodyCost: getBodyCost(body),
    bodyCarryParts: sets * 2,
    maxCarryParts: maxCarryParts,
    requiredCarryParts: requiredCarryParts,
    targetCarryParts: requiredCarryParts,
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
