function canRepairStructure(structure) {
  return !!(
    structure.my ||
    structure.structureType === STRUCTURE_ROAD ||
    structure.structureType === STRUCTURE_CONTAINER ||
    structure.structureType === STRUCTURE_WALL
  );
}

function isEmergencyRepairTarget(structure) {
  if (!canRepairStructure(structure)) return false;
  if (!structure.hitsMax || structure.hits >= structure.hitsMax) return false;

  if (
    structure.structureType !== STRUCTURE_ROAD &&
    structure.hits < 100
  ) {
    return true;
  }

  if (
    structure.structureType === STRUCTURE_SPAWN ||
    structure.structureType === STRUCTURE_TOWER
  ) {
    return structure.hits < structure.hitsMax * 0.5;
  }

  if (structure.structureType === STRUCTURE_CONTAINER) {
    return structure.hits < Math.min(25000, structure.hitsMax * 0.2);
  }

  return false;
}

function isGeneralRepairTarget(structure) {
  if (!canRepairStructure(structure)) return false;
  if (!structure.hitsMax || structure.hits >= structure.hitsMax) return false;
  if (structure.structureType === STRUCTURE_WALL) return false;
  if (structure.structureType === STRUCTURE_RAMPART) {
    return structure.hits < 10000;
  }
  if (structure.structureType === STRUCTURE_ROAD) {
    return structure.hits < structure.hitsMax * 0.6;
  }
  if (structure.structureType === STRUCTURE_CONTAINER) {
    return structure.hits < structure.hitsMax * 0.8;
  }

  return structure.hits < structure.hitsMax * 0.8;
}

module.exports = {
  isEmergencyRepairTarget: isEmergencyRepairTarget,
  isGeneralRepairTarget: isGeneralRepairTarget
};
