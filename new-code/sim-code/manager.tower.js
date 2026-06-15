const repairPolicy = require('repair.policy');

const PEACE_ENERGY_RESERVE = 800;
const GENERAL_REPAIR_RANGE = 12;

function getThreatScore(creep) {
  return (
    creep.getActiveBodyparts(HEAL) * 30 +
    creep.getActiveBodyparts(RANGED_ATTACK) * 20 +
    creep.getActiveBodyparts(ATTACK) * 15 +
    creep.getActiveBodyparts(WORK) * 5
  );
}

function selectHostile(tower, hostiles) {
  let selected = hostiles[0];

  for (const hostile of hostiles) {
    const score = getThreatScore(hostile);
    const selectedScore = getThreatScore(selected);
    if (
      score > selectedScore ||
      (
        score === selectedScore &&
        tower.pos.getRangeTo(hostile) < tower.pos.getRangeTo(selected)
      )
    ) {
      selected = hostile;
    }
  }

  return selected;
}

function selectRepairTarget(tower, structures, emergencyOnly) {
  const candidates = structures.filter(structure => {
    const repairable = emergencyOnly
      ? repairPolicy.isEmergencyRepairTarget(structure)
      : repairPolicy.isGeneralRepairTarget(structure);
    if (!repairable) return false;
    if (emergencyOnly) return true;

    return (
      tower.pos.getRangeTo(structure) <= GENERAL_REPAIR_RANGE ||
      tower.store.getUsedCapacity(RESOURCE_ENERGY) >= 800
    );
  });
  if (candidates.length === 0) return null;

  let selected = candidates[0];
  for (const structure of candidates) {
    const range = tower.pos.getRangeTo(structure);
    const selectedRange = tower.pos.getRangeTo(selected);
    const ratio = structure.hits / structure.hitsMax;
    const selectedRatio = selected.hits / selected.hitsMax;
    if (
      ratio < selectedRatio ||
      (ratio === selectedRatio && range < selectedRange)
    ) {
      selected = structure;
    }
  }

  return selected;
}

function run(room) {
  const towers = room.find(FIND_MY_STRUCTURES, {
    filter: structure => structure.structureType === STRUCTURE_TOWER
  });
  if (towers.length === 0) return;

  const hostiles = room.find(FIND_HOSTILE_CREEPS);
  const injured = room.find(FIND_MY_CREEPS, {
    filter: creep => creep.hits < creep.hitsMax
  });
  const structures = room.find(FIND_STRUCTURES);

  for (const tower of towers) {
    if (hostiles.length > 0) {
      const target = selectHostile(tower, hostiles);
      if (target) tower.attack(target);
      continue;
    }

    if (injured.length > 0) {
      const target = tower.pos.findClosestByRange(injured);
      if (target) tower.heal(target);
      continue;
    }

    const emergencyTarget = selectRepairTarget(tower, structures, true);
    if (emergencyTarget) {
      tower.repair(emergencyTarget);
      continue;
    }

    if (
      tower.store.getUsedCapacity(RESOURCE_ENERGY) <= PEACE_ENERGY_RESERVE
    ) {
      continue;
    }

    const repairTarget = selectRepairTarget(tower, structures, false);
    if (repairTarget) tower.repair(repairTarget);
  }
}

module.exports = {
  run: run
};
