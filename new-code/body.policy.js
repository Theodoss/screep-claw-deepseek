const SOURCE_ENERGY_PER_TICK = 10;
const CARRY_CAPACITY_PER_PART = 50;
const HAULER_SET_COST = 150;
const HAULER_SET_PARTS = 3;
const HAULER_THROUGHPUT_MARGIN = 1.1;
const MIN_HAULER_CARRY_PARTS = 6;
const DEFAULT_SOURCE_DISTANCE = 10;

function getBodyCost(body) {
  return body.reduce(
    (total, part) => total + (BODYPART_COST[part] || 0),
    0
  );
}

function buildStaticUpgraderBody(energyCapacity, desiredWork) {
  // Find the (WORK, CARRY, MOVE) combination within budget that maximizes
  // effective upgrade throughput. Key insight: each WORK part generates
  // 1 fatigue/tick while upgrading, and each MOVE clears 2 fatigue/tick.
  // The old [WORK×N, CARRY, MOVE] formula gave oversized WORK counts
  // with only 1 MOVE, making the creep crawl after 5 ticks of upgrading.
  // Now we balance to achieve zero net fatigue with adequate carry capacity
  // so the upgrader spends ~80% of its time upgrading, not refilling.
  const maxWork = Math.min(48, Math.max(1, desiredWork || 1));
  let bestConfig = { w: 1, c: 1, m: 1, effective: 0 };
  const REFILL_COST = 8; // Approximate ticks per refill trip (walk + withdraw)

  for (let w = maxWork; w >= 1; w--) {
    for (let c = 1; c <= 16; c++) {
      const m = Math.ceil((w + c) / 2);
      const cost = w * BODYPART_COST[WORK] +
        c * BODYPART_COST[CARRY] +
        m * BODYPART_COST[MOVE];
      if (cost > energyCapacity) continue;

      const upgradeTicks = (c * CARRY_CAPACITY_PER_PART) / w;
      const uptime = upgradeTicks / (upgradeTicks + REFILL_COST);
      const effective = w * uptime;

      if (effective > bestConfig.effective) {
        bestConfig = { w, c, m, effective };
      }
    }
  }

  const body = [];
  for (let i = 0; i < bestConfig.w; i++) body.push(WORK);
  for (let i = 0; i < bestConfig.c; i++) body.push(CARRY);
  for (let i = 0; i < bestConfig.m; i++) body.push(MOVE);
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
