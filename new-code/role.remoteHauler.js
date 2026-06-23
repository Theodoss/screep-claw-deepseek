const economy = require('manager.economy');
const remote = require('manager.remote');
const managerEconomy = require('manager.economy');

function closestTarget(creep, targets) {
  if (targets.length === 0) return null;
  return (
    creep.pos.findClosestByPath(targets) ||
    creep.pos.findClosestByRange(targets) ||
    targets[0]
  );
}

function findHomeDeliveryTarget(creep) {
  const myStructures = creep.room.find(FIND_MY_STRUCTURES);
  const spawnTargets = [];
  const extTargets = [];
  const towerTargets = [];

  for (let index = 0; index < myStructures.length; index++) {
    const structure = myStructures[index];
    if (!structure.store) continue;
    if (structure.store.getFreeCapacity(RESOURCE_ENERGY) <= 0) continue;

    if (structure.structureType === STRUCTURE_SPAWN) {
      spawnTargets.push(structure);
    } else if (structure.structureType === STRUCTURE_EXTENSION) {
      extTargets.push(structure);
    } else if (
      structure.structureType === STRUCTURE_TOWER &&
      structure.store.getUsedCapacity(RESOURCE_ENERGY) <
        remote.TOWER_LOW_ENERGY
    ) {
      towerTargets.push(structure);
    }
  }

  // 1. Spawn
  if (spawnTargets.length > 0) {
    return closestTarget(creep, spawnTargets);
  }
  // 2. Extension
  if (extTargets.length > 0) {
    return closestTarget(creep, extTargets);
  }
  // 3. Tower
  if (towerTargets.length > 0) {
    return closestTarget(creep, towerTargets);
  }
  // 4. Upgrade container
  const controllerContainer = economy.getControllerContainer(creep.room);
  if (
    controllerContainer &&
    controllerContainer.store.getFreeCapacity(RESOURCE_ENERGY) > 0
  ) {
    return controllerContainer;
  }
  // 5. Storage
  if (
    creep.room.storage &&
    creep.room.storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0
  ) {
    return creep.room.storage;
  }

  return null;
}

function waitAtHome(creep) {
  const spawns = creep.room.find(FIND_MY_SPAWNS);
  const target = creep.room.storage || spawns[0] || null;
  if (target && creep.pos.getRangeTo(target) > 3) {
    creep.moveTo(target, { reusePath: 10 });
  }
}

function deliver(creep) {
  if (creep.pos.roomName !== creep.memory.homeRoom) {
    creep.moveTo(
      new RoomPosition(25, 25, creep.memory.homeRoom),
      { reusePath: 20 }
    );
    return;
  }

  const target = findHomeDeliveryTarget(creep);
  if (!target) {
    waitAtHome(creep);
    return;
  }

  const carried = creep.store.getUsedCapacity(RESOURCE_ENERGY);
  const result = creep.transfer(target, RESOURCE_ENERGY);
  if (result === OK) {
    managerEconomy.recordHarvest(creep.memory.homeRoom, carried);
  } else if (result === ERR_NOT_IN_RANGE) {
    creep.moveTo(target, { reusePath: 10 });
  }
}

function selectNearbySalvage(creep, sourceConfig) {
  const dropped = creep.room.find(FIND_DROPPED_RESOURCES);
  let selected = null;

  for (let index = 0; index < dropped.length; index++) {
    const resource = dropped[index];
    if (resource.resourceType !== RESOURCE_ENERGY) continue;
    if (
      resource.pos.getRangeTo(
        sourceConfig.containerX,
        sourceConfig.containerY
      ) > 2
    ) {
      continue;
    }
    if (!selected || resource.amount > selected.target.amount) {
      selected = {
        target: resource,
        type: 'pickup'
      };
    }
  }
  if (selected) return selected;

  const tombstones = creep.room.find(FIND_TOMBSTONES);
  for (let index = 0; index < tombstones.length; index++) {
    const tombstone = tombstones[index];
    if (
      tombstone.pos.getRangeTo(
        sourceConfig.containerX,
        sourceConfig.containerY
      ) <= 2 &&
      tombstone.store.getUsedCapacity(RESOURCE_ENERGY) > 0
    ) {
      return {
        target: tombstone,
        type: 'withdraw'
      };
    }
  }

  const ruins = creep.room.find(FIND_RUINS);
  for (let index = 0; index < ruins.length; index++) {
    const ruin = ruins[index];
    if (
      ruin.pos.getRangeTo(
        sourceConfig.containerX,
        sourceConfig.containerY
      ) <= 2 &&
      ruin.store.getUsedCapacity(RESOURCE_ENERGY) > 0
    ) {
      return {
        target: ruin,
        type: 'withdraw'
      };
    }
  }

  return null;
}

// Dropped energy near the source/container decays at 1/tick (miner overflow
// when the container is full, or drops when the miner can't reach the
// container tile). Grab the biggest such pile FIRST — before the
// non-decaying container — so it isn't lost. Range 3 covers the miner tile
// plus the ring of tiles overflow lands on.
function selectDroppedEnergy(creep, sourceConfig) {
  const dropped = creep.room.find(FIND_DROPPED_RESOURCES);
  let best = null;

  for (let index = 0; index < dropped.length; index++) {
    const resource = dropped[index];
    if (resource.resourceType !== RESOURCE_ENERGY) continue;
    if (
      resource.pos.getRangeTo(
        sourceConfig.containerX,
        sourceConfig.containerY
      ) > 3
    ) {
      continue;
    }
    if (!best || resource.amount > best.amount) {
      best = resource;
    }
  }

  return best;
}

function collect(creep, sourceConfig) {
  var containerX = sourceConfig.containerX;
  var containerY = sourceConfig.containerY;
  var containerRoom = sourceConfig.roomName;
  var containerPosition = new RoomPosition(
    containerX,
    containerY,
    containerRoom
  );

  // Block the container tile so haulers never path onto it.
  // The miner must stand on the container to harvest — if a
  // hauler occupies that tile even for one tick, it blocks
  // the miner and stops energy flow.
  var moveOpts = {
    range: 1,
    reusePath: 20,
    costCallback: function (roomName, costMatrix) {
      if (roomName === containerRoom) {
        costMatrix.set(containerX, containerY, 255);
      }
      return costMatrix;
    }
  };

  if (creep.pos.roomName !== containerRoom) {
    creep.moveTo(containerPosition, moveOpts);
    return;
  }

  if (
    creep.pos.x === containerX &&
    creep.pos.y === containerY
  ) {
    // Should never happen now (costCallback blocks it), but
    // just in case — move off immediately.
    creep.moveTo(remote.getWaitPosition(sourceConfig), {
      reusePath: 5
    });
    return;
  }

  // Priority: decaying ground energy before the (non-decaying) container.
  const groundEnergy = selectDroppedEnergy(creep, sourceConfig);
  if (groundEnergy) {
    if (creep.pickup(groundEnergy) === ERR_NOT_IN_RANGE) {
      creep.moveTo(groundEnergy, { reusePath: 5 });
    }
    return;
  }

  if (creep.pos.getRangeTo(containerPosition) > 1) {
    creep.moveTo(containerPosition, moveOpts);
    return;
  }

  const container = remote.findContainerAt(
    sourceConfig.roomName,
    sourceConfig.containerX,
    sourceConfig.containerY
  );
  if (
    container &&
    container.store.getUsedCapacity(RESOURCE_ENERGY) > 0
  ) {
    creep.withdraw(container, RESOURCE_ENERGY);
    return;
  }

  const salvage = selectNearbySalvage(creep, sourceConfig);
  if (salvage) {
    const result = salvage.type === 'pickup'
      ? creep.pickup(salvage.target)
      : creep.withdraw(salvage.target, RESOURCE_ENERGY);
    if (result === ERR_NOT_IN_RANGE) {
      creep.moveTo(salvage.target, { reusePath: 5 });
    }
    return;
  }

  const waitPosition = remote.getWaitPosition(sourceConfig);
  if (creep.pos.getRangeTo(waitPosition) > 0) {
    creep.moveTo(waitPosition, { reusePath: 5 });
  }
}

module.exports = {
  run: function (creep) {
    const homeRoom = creep.memory.homeRoom;
    const remoteRoom = creep.memory.remoteRoom;
    const sourceConfig = remote.getSourceConfig(
      homeRoom,
      remoteRoom,
      creep.memory.sourceIndex
    );

    if (!sourceConfig || sourceConfig.enabled !== true) {
      remote.retreat(creep, homeRoom);
      return;
    }
    if (remote.isRemotePaused(homeRoom, remoteRoom)) {
      // Deliver energy home before retreating so it isn't trapped in the hauler.
      if (creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
        deliver(creep);
        return;
      }
      remote.retreat(creep, homeRoom);
      return;
    }

    const used = creep.store.getUsedCapacity(RESOURCE_ENERGY);
    const free = creep.store.getFreeCapacity(RESOURCE_ENERGY);
    const cap = creep.store.getCapacity(RESOURCE_ENERGY);

    if (free === 0 || (used > 0 && cap > 0 && free / cap <= 0.2)) {
      creep.memory.delivering = true;
    }
    if (used === 0 || (creep.memory.delivering && cap > 0 && used / cap < 0.1)) {
      creep.memory.delivering = false;
    }

    if (creep.memory.delivering) {
      deliver(creep);
      return;
    }

    collect(creep, sourceConfig);
  }
};
