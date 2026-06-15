const SAMPLE_INTERVAL = 50;
const SHORT_WINDOW = 300;
const LONG_WINDOW = 1500;
const MAX_SAMPLES = 40;
const CONTROLLER_EMERGENCY_TICKS = 4000;

function ensureRoomMemory(roomName) {
  if (!Memory.rooms) Memory.rooms = {};
  if (!Memory.rooms[roomName]) Memory.rooms[roomName] = {};

  const roomMemory = Memory.rooms[roomName];
  if (!roomMemory.economyAccounting) {
    roomMemory.economyAccounting = {
      totalHarvested: 0,
      totalUpgradeSpent: 0,
      samples: [],
      upgradeCredits: 0,
      lastCreditTick: Game.time
    };
  }

  return roomMemory.economyAccounting;
}

function getBodyCost(creep) {
  let cost = 0;

  for (const part of creep.body) {
    cost += BODYPART_COST[part.type] || 0;
  }

  return cost;
}

function recordHarvest(roomName, amount) {
  if (!amount || amount <= 0) return;

  const memory = ensureRoomMemory(roomName);
  if (typeof memory.startedAt !== 'number') {
    memory.startedAt = Game.time;
    memory.startedHarvested = memory.totalHarvested || 0;
  }
  memory.totalHarvested = (memory.totalHarvested || 0) + amount;
}

function getStoredEnergy(room, creeps) {
  let total = 0;
  const structures = room.find(FIND_STRUCTURES);

  for (const structure of structures) {
    if (
      !structure.store ||
      (
        !structure.my &&
        structure.structureType !== STRUCTURE_CONTAINER
      )
    ) {
      continue;
    }
    total += structure.store.getUsedCapacity(RESOURCE_ENERGY);
  }

  for (const creep of creeps) {
    total += creep.store.getUsedCapacity(RESOURCE_ENERGY);
  }

  return total;
}

function addSample(memory, storedEnergy) {
  if (!Array.isArray(memory.samples)) memory.samples = [];

  const last = memory.samples[memory.samples.length - 1];
  if (last && Game.time - last.tick < SAMPLE_INTERVAL) return;

  memory.samples.push({
    tick: Game.time,
    harvested: memory.totalHarvested || 0,
    storedEnergy: storedEnergy
  });
  memory.samples = memory.samples.slice(-MAX_SAMPLES);
}

function getBaselineSample(memory, window, field) {
  const targetTick = Game.time - window;
  let baseline = null;

  for (const sample of memory.samples || []) {
    if (typeof sample[field] !== 'number') continue;
    if (!baseline) baseline = sample;
    if (sample.tick >= targetTick) {
      baseline = sample;
      break;
    }
  }

  return baseline;
}

function getIncomeRate(memory, window) {
  const currentHarvested = memory.totalHarvested || 0;
  let baseline = getBaselineSample(memory, window, 'harvested');

  if (!baseline && typeof memory.startedAt === 'number') {
    baseline = {
      tick: memory.startedAt,
      harvested: memory.startedHarvested || 0
    };
  }

  if (!baseline || Game.time <= baseline.tick) return 0;

  return (currentHarvested - baseline.harvested) /
    (Game.time - baseline.tick);
}

function getEnergyFlow(memory, window, storedEnergy) {
  const baseline = getBaselineSample(memory, window, 'storedEnergy');
  if (!baseline || Game.time <= baseline.tick) {
    return {
      consumptionRate: 0,
      netRate: 0
    };
  }

  const elapsed = Game.time - baseline.tick;
  const harvested = (memory.totalHarvested || 0) - baseline.harvested;
  const inventoryChange = storedEnergy - baseline.storedEnergy;

  return {
    consumptionRate: (harvested - inventoryChange) / elapsed,
    netRate: inventoryChange / elapsed
  };
}

function getReplacementRate(creeps) {
  let rate = 0;

  for (const creep of creeps) {
    if (creep.memory.role === 'guard') {
      continue;
    }

    rate += getBodyCost(creep) / CREEP_LIFE_TIME;
  }

  return rate;
}

function refreshCredits(memory) {
  const lastTick = typeof memory.lastCreditTick === 'number'
    ? memory.lastCreditTick
    : Game.time;
  const elapsed = Math.max(0, Game.time - lastTick);
  const rate = memory.upgradeRate || 0;
  const target = memory.upgraderWorkTarget || 0;

  if (rate <= 0 || target <= 0) {
    memory.upgradeCredits = 0;
  } else if (elapsed > 0) {
    const cap = Math.max(10, target * 20);
    memory.upgradeCredits = Math.min(
      cap,
      (memory.upgradeCredits || 0) + elapsed * rate
    );
  }

  memory.lastCreditTick = Game.time;
}

function controllerEmergency(room) {
  return !!(
    room.controller &&
    typeof room.controller.ticksToDowngrade === 'number' &&
    room.controller.ticksToDowngrade < CONTROLLER_EMERGENCY_TICKS
  );
}

function update(room, context) {
  const input = context || {};
  const memory = ensureRoomMemory(room.name);
  const creeps = room.find(FIND_MY_CREEPS);
  const storedEnergy = getStoredEnergy(room, creeps);

  addSample(memory, storedEnergy);

  const shortIncomeRate = getIncomeRate(memory, SHORT_WINDOW);
  const longIncomeRate = getIncomeRate(memory, LONG_WINDOW);
  const shortFlow = getEnergyFlow(memory, SHORT_WINDOW, storedEnergy);
  const longFlow = getEnergyFlow(memory, LONG_WINDOW, storedEnergy);
  const measuredRates = [shortIncomeRate, longIncomeRate].filter(
    rate => rate > 0
  );
  const incomeRate = measuredRates.length > 0
    ? Math.min.apply(null, measuredRates)
    : 0;
  const replacementRate = getReplacementRate(creeps);
  const constructionReserve = input.constructionCount > 0
    ? (storedEnergy > 50000 ? 0 : Math.min(2, incomeRate * 0.15))
    : 0;
  const repairReserve = input.repairBacklog
    ? Math.min(1, incomeRate * 0.1)
    : 0;
  const defenseReserve = input.hostilesCount > 0
    ? incomeRate
    : Math.min(0.5, incomeRate * 0.05);
  const safetyReserve = incomeRate > 0
    ? (storedEnergy > 5000 ? 0 : storedEnergy > 2000 ? Math.max(0.5, incomeRate * 0.05) : Math.max(1, incomeRate * 0.1))
    : 0;
  const emergency = controllerEmergency(room);
  const recovery = !!(
    input.energyStarved ||
    input.minersHealthy === false ||
    (input.haulersHealthy === false && storedEnergy < 5000)
  );
  let upgradeMultiplier = 0.80;
  if (storedEnergy > 30000) upgradeMultiplier = 1.00;
  else if (storedEnergy > 10000) upgradeMultiplier = 0.95;
  else if (storedEnergy > 5000) upgradeMultiplier = 0.88;

  let upgradeRate = Math.max(
    0,
    (
      incomeRate -
      replacementRate -
      constructionReserve -
      repairReserve -
      defenseReserve -
      safetyReserve
    ) * upgradeMultiplier
  );

  if (recovery || input.hostilesCount > 0) {
    upgradeRate = 0;
  }
  if (emergency) {
    upgradeRate = Math.max(1, upgradeRate);
  }

  let upgraderWorkTarget = upgradeRate >= 0.25
    ? Math.max(1, Math.floor(upgradeRate))
    : 0;
  if (room.controller && room.controller.level >= 8) {
    upgraderWorkTarget = Math.min(
      CONTROLLER_MAX_UPGRADE_PER_TICK,
      upgraderWorkTarget
    );
  }
  upgraderWorkTarget = Math.min(48, upgraderWorkTarget);

  memory.shortIncomeRate = shortIncomeRate;
  memory.longIncomeRate = longIncomeRate;
  memory.incomeRate = incomeRate;
  memory.storedEnergy = storedEnergy;
  memory.shortNetEnergyRate = shortFlow.netRate;
  memory.longNetEnergyRate = longFlow.netRate;
  memory.shortConsumptionRate = shortFlow.consumptionRate;
  memory.longConsumptionRate = longFlow.consumptionRate;
  memory.replacementRate = replacementRate;
  memory.constructionReserve = constructionReserve;
  memory.repairReserve = repairReserve;
  memory.defenseReserve = defenseReserve;
  memory.safetyReserve = safetyReserve;
  memory.upgradeRate = upgradeRate;
  memory.upgraderWorkTarget = upgraderWorkTarget;
  memory.recovery = recovery;
  memory.controllerEmergency = emergency;
  memory.lastUpdated = Game.time;

  refreshCredits(memory);

  return memory;
}

function getState(room) {
  const memory = ensureRoomMemory(room.name);
  const roomMemory = Memory.rooms && Memory.rooms[room.name]
    ? Memory.rooms[room.name]
    : {};
  const containerReady = !!(
    roomMemory.containerEconomy &&
    roomMemory.containerEconomy.ready
  );

  if (!containerReady) {
    memory.upgradeRate = 1;
    memory.upgraderWorkTarget = 1;
    memory.upgradeCredits = Math.max(1, memory.upgradeCredits || 0);
    memory.recovery = false;
  }

  refreshCredits(memory);
  return memory;
}

function canUpgrade(room, workParts) {
  const memory = getState(room);
  if (controllerEmergency(room)) return true;

  const cost = Math.max(1, workParts || 1);
  return (
    (memory.upgraderWorkTarget || 0) > 0 &&
    (memory.upgradeCredits || 0) >= cost
  );
}

function recordUpgrade(room, amount) {
  const memory = getState(room);
  const spent = Math.max(0, amount || 0);

  memory.totalUpgradeSpent = (memory.totalUpgradeSpent || 0) + spent;
  if (!controllerEmergency(room)) {
    memory.upgradeCredits = Math.max(
      0,
      (memory.upgradeCredits || 0) - spent
    );
  }
}

function getControllerContainer(room) {
  if (!room.controller) return null;

  const roomMemory = Memory.rooms && Memory.rooms[room.name]
    ? Memory.rooms[room.name]
    : {};
  const sourceMemory = roomMemory.sources || {};
  const sourceContainerIds = {};

  for (const sourceId in sourceMemory) {
    const containerId = sourceMemory[sourceId].containerId;
    if (containerId) sourceContainerIds[containerId] = true;
  }

  const accounting = ensureRoomMemory(room.name);
  if (accounting.controllerContainerId) {
    const remembered = Game.getObjectById(
      accounting.controllerContainerId
    );
    if (
      remembered &&
      !sourceContainerIds[remembered.id] &&
      remembered.pos.getRangeTo(room.controller) <= 3
    ) {
      return remembered;
    }
    delete accounting.controllerContainerId;
  }

  const containers = room.find(FIND_STRUCTURES, {
    filter: structure =>
      structure.structureType === STRUCTURE_CONTAINER &&
      !sourceContainerIds[structure.id] &&
      structure.pos.getRangeTo(room.controller) <= 3
  });
  if (containers.length === 0) return null;

  let selected = containers[0];
  for (const container of containers) {
    if (
      container.pos.getRangeTo(room.controller) <
      selected.pos.getRangeTo(room.controller)
    ) {
      selected = container;
    }
  }

  accounting.controllerContainerId = selected.id;
  return selected;
}

module.exports = {
  canUpgrade: canUpgrade,
  controllerEmergency: controllerEmergency,
  getControllerContainer: getControllerContainer,
  getState: getState,
  recordHarvest: recordHarvest,
  recordUpgrade: recordUpgrade,
  update: update
};
