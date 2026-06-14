const CONTROLLER_LOW_BUFFER_TICKS = 40;
const CONTROLLER_TARGET_BUFFER_TICKS = 100;
const CONTROLLER_MIN_LOW_ENERGY = 200;
const CONTROLLER_MIN_TARGET_ENERGY = 500;
const CONTROLLER_MAX_LOW_ENERGY = 800;
const CONTROLLER_MAX_TARGET_ENERGY = 1600;

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function clearDeliveryAssignment(creep) {
  delete creep.memory.deliveryTargetId;
  delete creep.memory.deliveryAmount;
  delete creep.memory.deliveryReason;
  delete creep.memory.deliveryIntentTick;
}

function getStoreCapacity(target) {
  const capacity = target.store.getCapacity(RESOURCE_ENERGY);
  if (typeof capacity === 'number') return capacity;

  return (
    target.store.getUsedCapacity(RESOURCE_ENERGY) +
    target.store.getFreeCapacity(RESOURCE_ENERGY)
  );
}

function getControllerBuffer(state, container) {
  const workTarget = Math.max(1, state.upgraderWorkTarget || 0);
  const capacity = getStoreCapacity(container);
  const lowEnergy = Math.min(
    capacity,
    clamp(
      workTarget * CONTROLLER_LOW_BUFFER_TICKS,
      CONTROLLER_MIN_LOW_ENERGY,
      CONTROLLER_MAX_LOW_ENERGY
    )
  );
  const targetEnergy = Math.min(
    capacity,
    Math.max(
      lowEnergy,
      clamp(
        workTarget * CONTROLLER_TARGET_BUFFER_TICKS,
        CONTROLLER_MIN_TARGET_ENERGY,
        CONTROLLER_MAX_TARGET_ENERGY
      )
    )
  );

  return {
    lowEnergy: lowEnergy,
    targetEnergy: targetEnergy
  };
}

function getCommittedEnergy(creep, targetId) {
  let committed = 0;

  for (const name in Game.creeps) {
    const other = Game.creeps[name];
    if (other.name === creep.name) continue;
    if (other.memory.role !== 'rcl2Hauler') continue;
    if (other.memory.home !== creep.memory.home) continue;
    if (other.memory.deliveryTargetId !== targetId) continue;
    if (
      typeof other.memory.deliveryIntentTick === 'number' &&
      other.memory.deliveryIntentTick < Game.time
    ) {
      continue;
    }

    const carried = other.store.getUsedCapacity(RESOURCE_ENERGY);
    const assigned = Math.max(
      0,
      other.memory.deliveryAmount || carried
    );
    committed += Math.min(carried, assigned);
  }

  return committed;
}

function getExistingDeliveryRequest(creep) {
  if (!creep.memory.deliveryTargetId) return null;
  if (
    typeof creep.memory.deliveryIntentTick === 'number' &&
    creep.memory.deliveryIntentTick < Game.time
  ) {
    clearDeliveryAssignment(creep);
    return null;
  }

  const target = Game.getObjectById(creep.memory.deliveryTargetId);
  if (!target || !target.store) {
    clearDeliveryAssignment(creep);
    return null;
  }

  const amount = Math.min(
    creep.store.getUsedCapacity(RESOURCE_ENERGY),
    target.store.getFreeCapacity(RESOURCE_ENERGY),
    Math.max(0, creep.memory.deliveryAmount || 0)
  );
  if (amount <= 0) {
    clearDeliveryAssignment(creep);
    return null;
  }

  return {
    target: target,
    amount: amount,
    reason: creep.memory.deliveryReason || 'reserved'
  };
}

function getControllerDeliveryRequest(creep, container, state, force) {
  if (!container || !state || state.recovery) return null;
  if (!force && (state.upgraderWorkTarget || 0) <= 0) return null;

  const existing = getExistingDeliveryRequest(creep);
  if (existing && existing.target.id === container.id) return existing;
  if (existing) clearDeliveryAssignment(creep);

  const used = container.store.getUsedCapacity(RESOURCE_ENERGY);
  const capacity = getStoreCapacity(container);
  const buffer = getControllerBuffer(state, container);
  const lowEnergy = force ? capacity : buffer.lowEnergy;
  const targetEnergy = force ? capacity : buffer.targetEnergy;

  if (used > lowEnergy) return null;

  const committed = getCommittedEnergy(creep, container.id);
  const demand = Math.max(0, targetEnergy - used - committed);
  const amount = Math.min(
    demand,
    creep.store.getUsedCapacity(RESOURCE_ENERGY),
    container.store.getFreeCapacity(RESOURCE_ENERGY)
  );
  if (amount <= 0) return null;

  creep.memory.deliveryTargetId = container.id;
  creep.memory.deliveryAmount = amount;
  creep.memory.deliveryReason = force
    ? 'controller-emergency'
    : 'controller-buffer';
  delete creep.memory.deliveryIntentTick;

  return {
    target: container,
    amount: amount,
    reason: creep.memory.deliveryReason
  };
}

module.exports = {
  clearDeliveryAssignment: clearDeliveryAssignment,
  getControllerBuffer: getControllerBuffer,
  getControllerDeliveryRequest: getControllerDeliveryRequest,
  getExistingDeliveryRequest: getExistingDeliveryRequest
};
