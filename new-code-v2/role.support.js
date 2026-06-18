const economy = require('manager.economy');
const repairPolicy = require('repair.policy');

const TOWER_PEACE_RESERVE = 800;
const roomWorkCache = {};

function getRoomData(room) {
  const cached = roomWorkCache[room.name];
  if (cached && cached.tick === Game.time) return cached;

  const structures = room.find(FIND_STRUCTURES);
  const data = {
    tick: Game.time,
    structures: structures,
    myStructures: structures.filter(structure => structure.my),
    hostiles: room.find(FIND_HOSTILE_CREEPS),
    constructionSites: room.find(FIND_MY_CONSTRUCTION_SITES, {
      filter: site => site.structureType !== STRUCTURE_WALL
    })
  };

  roomWorkCache[room.name] = data;
  return data;
}

function transferEnergy(creep, target) {
  creep.memory.task = `transfer:${target.structureType}`;
  const result = creep.transfer(target, RESOURCE_ENERGY);
  if (result === ERR_NOT_IN_RANGE) {
    creep.moveTo(target, { visualizePathStyle: { stroke: '#ffffff' } });
  }
  return result;
}

function repair(creep, target) {
  creep.memory.task = `repair:${target.structureType}`;
  const result = creep.repair(target);
  if (result === ERR_NOT_IN_RANGE) {
    creep.moveTo(target, { visualizePathStyle: { stroke: '#00ffff' } });
  }
  return result;
}

function build(creep, target) {
  creep.memory.task = `build:${target.structureType}`;
  const result = creep.build(target);
  if (result === ERR_NOT_IN_RANGE) {
    creep.moveTo(target, { visualizePathStyle: { stroke: '#00ff00' } });
  }
  return result;
}

function getWorkParts(creep) {
  return Math.max(1, creep.getActiveBodyparts(WORK));
}

function runEmergencyController(creep) {
  if (!economy.controllerEmergency(creep.room)) return false;
  if (!creep.room.controller) return false;

  const workParts = getWorkParts(creep);
  const available = creep.store.getUsedCapacity(RESOURCE_ENERGY);
  creep.memory.task = 'upgrade:controller-emergency';
  const result = creep.upgradeController(creep.room.controller);
  if (result === ERR_NOT_IN_RANGE) {
    creep.moveTo(creep.room.controller, {
      visualizePathStyle: { stroke: '#ffffff' }
    });
  } else if (result === OK) {
    economy.recordUpgrade(creep.room, Math.min(workParts, available));
  }
  return true;
}

function findSpawnOrExtensionTarget(creep) {
  const targets = getRoomData(creep.room).myStructures.filter(
    structure =>
      (
        structure.structureType === STRUCTURE_SPAWN ||
        structure.structureType === STRUCTURE_EXTENSION
      ) &&
      structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0
  );
  if (targets.length === 0) return null;

  return (
    creep.pos.findClosestByPath(targets) ||
    creep.pos.findClosestByRange(targets)
  );
}

function fillSpawnOrExtensions(creep) {
  const target = findSpawnOrExtensionTarget(creep);
  if (!target) return false;

  transferEnergy(creep, target);
  return true;
}

function fillWartimeTower(creep) {
  const data = getRoomData(creep.room);
  const towers = data.myStructures.filter(
    structure =>
      structure.structureType === STRUCTURE_TOWER &&
      structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0 &&
      (
        data.hostiles.length > 0 ||
        structure.store.getUsedCapacity(RESOURCE_ENERGY) <
          TOWER_PEACE_RESERVE
      )
  );
  if (towers.length === 0) return false;

  const target = creep.pos.findClosestByPath(towers);
  if (!target) return false;

  transferEnergy(creep, target);
  return true;
}

function selectLowestHitsRatio(creep, structures) {
  if (structures.length === 0) return null;

  let selected = structures[0];
  for (const structure of structures) {
    const ratio = structure.hits / structure.hitsMax;
    const selectedRatio = selected.hits / selected.hitsMax;
    if (
      ratio < selectedRatio ||
      (
        ratio === selectedRatio &&
        creep.pos.getRangeTo(structure) < creep.pos.getRangeTo(selected)
      )
    ) {
      selected = structure;
    }
  }

  return selected;
}

function getEmergencyRepairTarget(room, creep) {
  const structures = getRoomData(room).structures.filter(
    repairPolicy.isEmergencyRepairTarget
  );
  return selectLowestHitsRatio(creep, structures);
}

function getGeneralRepairTarget(room, creep) {
  const structures = getRoomData(room).structures.filter(
    repairPolicy.isGeneralRepairTarget
  );
  return selectLowestHitsRatio(creep, structures);
}

function hasEmergencyRepair(room) {
  return getRoomData(room).structures.some(
    repairPolicy.isEmergencyRepairTarget
  );
}

function hasGeneralRepair(room) {
  return getRoomData(room).structures.some(
    repairPolicy.isGeneralRepairTarget
  );
}

function towersCanMaintain(room) {
  const towers = getRoomData(room).myStructures.filter(
    structure => structure.structureType === STRUCTURE_TOWER
  );
  if (towers.length === 0) return false;

  return towers.some(tower =>
    tower.store.getUsedCapacity(RESOURCE_ENERGY) > TOWER_PEACE_RESERVE
  );
}

function repairEmergency(creep) {
  const target = getEmergencyRepairTarget(creep.room, creep);
  if (!target) return false;

  repair(creep, target);
  return true;
}

function getConstructionPriority(site) {
  const priorities = {};
  priorities[STRUCTURE_SPAWN] = 0;
  priorities[STRUCTURE_EXTENSION] = 1;
  priorities[STRUCTURE_CONTAINER] = 2;
  priorities[STRUCTURE_TOWER] = 3;
  priorities[STRUCTURE_ROAD] = 4;

  return priorities[site.structureType] === undefined
    ? 5
    : priorities[site.structureType];
}

function selectConstructionSite(creep, sites) {
  let selected = sites[0];

  for (const site of sites) {
    const priority = getConstructionPriority(site);
    const selectedPriority = getConstructionPriority(selected);
    if (
      priority < selectedPriority ||
      (
        priority === selectedPriority &&
        creep.pos.getRangeTo(site) < creep.pos.getRangeTo(selected)
      )
    ) {
      selected = site;
    }
  }

  return selected;
}

function runConstruction(creep) {
  const sites = getRoomData(creep.room).constructionSites;
  if (sites.length === 0) return false;

  const site = selectConstructionSite(creep, sites);
  if (!site) return false;

  build(creep, site);
  return true;
}

function runGeneralRepair(creep) {
  if (towersCanMaintain(creep.room)) return false;

  const target = getGeneralRepairTarget(creep.room, creep);
  if (!target) return false;

  repair(creep, target);
  return true;
}

function runBudgetedUpgrade(creep) {
  if (!creep.room.controller) return false;

  const workParts = getWorkParts(creep);
  if (!economy.canUpgrade(creep.room, workParts)) return false;

  const available = creep.store.getUsedCapacity(RESOURCE_ENERGY);
  creep.memory.task = 'upgrade:controller-budgeted';
  const result = creep.upgradeController(creep.room.controller);
  if (result === ERR_NOT_IN_RANGE) {
    creep.moveTo(creep.room.controller, {
      visualizePathStyle: { stroke: '#ffffff' }
    });
  } else if (result === OK) {
    economy.recordUpgrade(creep.room, Math.min(workParts, available));
  }
  return true;
}

function repairControllerContainer(creep) {
  const container = economy.getControllerContainer(creep.room);
  if (
    !container ||
    container.hits >= container.hitsMax * 0.8
  ) {
    return false;
  }

  repair(creep, container);
  return true;
}

function runHarvesterWork(creep) {
  if (runEmergencyController(creep)) return true;
  if (fillSpawnOrExtensions(creep)) return true;
  if (repairEmergency(creep)) return true;
  if (fillWartimeTower(creep)) return true;
  if (runConstruction(creep)) return true;
  if (runGeneralRepair(creep)) return true;
  return runBudgetedUpgrade(creep);
}

function runBuilderWork(creep) {
  if (runEmergencyController(creep)) return true;
  if (fillSpawnOrExtensions(creep)) return true;
  if (repairEmergency(creep)) return true;
  if (fillWartimeTower(creep)) return true;
  if (runConstruction(creep)) return true;
  if (runGeneralRepair(creep)) return true;
  return runBudgetedUpgrade(creep);
}

function runUpgraderWork(creep) {
  if (runEmergencyController(creep)) return true;
  if (repairControllerContainer(creep)) return true;
  return runBudgetedUpgrade(creep);
}

function runRecoveryWork(creep) {
  if (runEmergencyController(creep)) return true;
  if (fillSpawnOrExtensions(creep)) return true;
  return repairEmergency(creep);
}

module.exports = {
  fillSpawnOrExtensions: fillSpawnOrExtensions,
  hasEmergencyRepair: hasEmergencyRepair,
  hasGeneralRepair: hasGeneralRepair,
  runBuilderWork: runBuilderWork,
  runHarvesterWork: runHarvesterWork,
  // Legacy role modules still use this entry point during memory migration.
  runPriorityWork: runBuilderWork,
  runRecoveryWork: runRecoveryWork,
  runUpgraderWork: runUpgraderWork,
  towersCanMaintain: towersCanMaintain
};
