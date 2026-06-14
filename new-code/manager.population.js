const POLICY_VERSION = 3;
const RCL1_SPAWN_ORDER = [
  'rcl1Harvester',
  'rcl1Builder',
  'rcl1Upgrader',
  'guard'
];
const LOCAL_ECONOMY_SPAWN_ORDER = [
  'rcl2Miner',
  'rcl2Hauler',
  'rcl1Builder',
  'rcl1Upgrader'
];

const FALLBACK = {
  NONE: 'none',
  BOOTSTRAP: 'bootstrap',
  ECONOMY_RECOVERY: 'economy-recovery',
  CONTROLLER_EMERGENCY: 'controller-emergency',
  DEFENSE: 'defense'
};

const FALLBACK_PROFILES = {
  none: {
    spawnOrder: [
      'rcl2Miner',
      'rcl2Hauler',
      'rcl1Builder',
      'rcl1Upgrader'
    ],
    suspendUpgrade: false
  },
  bootstrap: {
    spawnOrder: [
      'rcl1Harvester',
      'rcl2Miner',
      'rcl2Hauler',
      'rcl1Builder',
      'rcl1Upgrader'
    ],
    suspendUpgrade: true
  },
  'economy-recovery': {
    spawnOrder: [
      'rcl1Harvester',
      'rcl2Miner',
      'rcl2Hauler',
      'rcl1Builder',
      'rcl1Upgrader'
    ],
    suspendUpgrade: true
  },
  'controller-emergency': {
    spawnOrder: [
      'rcl2Miner',
      'rcl2Hauler',
      'rcl1Builder',
      'rcl1Upgrader'
    ],
    suspendUpgrade: false
  },
  defense: {
    spawnOrder: [
      'rcl2Miner',
      'rcl2Hauler',
      'guard',
      'rcl1Builder',
      'rcl1Upgrader'
    ],
    suspendUpgrade: true
  }
};

// This is the single population control table for owned rooms. Role names keep
// the current JavaScript implementation names until the TypeScript migration.
const RCL_POLICIES = {
  1: {
    economyMode: 'bootstrap',
    spawnOrder: RCL1_SPAWN_ORDER,
    population: {
      harvesterMin: 2,
      harvesterMax: 4,
      minersPerSource: 0,
      haulersPerSource: 0,
      linkedHaulersPerSource: 0,
      builderMax: 1,
      upgraderMax: 2,
      guardMax: 2,
      scoutMax: 0,
      reserverPerRemote: 0,
      remoteMinerPerSource: 0,
      remoteHaulerPerSource: 0,
      claimerMax: 0,
      pioneerMax: 0,
      mineralMinerMax: 0,
      labTechMax: 0
    }
  },
  2: {
    economyMode: 'container',
    spawnOrder: LOCAL_ECONOMY_SPAWN_ORDER,
    population: {
      harvesterMin: 0,
      harvesterMax: 4,
      minersPerSource: 1,
      haulersPerSource: 2,
      linkedHaulersPerSource: 1,
      builderMax: 1,
      upgraderMax: 2,
      guardMax: 2,
      scoutMax: 0,
      reserverPerRemote: 0,
      remoteMinerPerSource: 0,
      remoteHaulerPerSource: 0,
      claimerMax: 0,
      pioneerMax: 0,
      mineralMinerMax: 0,
      labTechMax: 0
    }
  },
  3: {
    economyMode: 'container-tower',
    spawnOrder: LOCAL_ECONOMY_SPAWN_ORDER,
    population: {
      harvesterMin: 0,
      harvesterMax: 4,
      minersPerSource: 1,
      haulersPerSource: 1.5,
      linkedHaulersPerSource: 1,
      builderMax: 1,
      upgraderMax: 2,
      guardMax: 2,
      scoutMax: 0,
      reserverPerRemote: 0,
      remoteMinerPerSource: 0,
      remoteHaulerPerSource: 0,
      claimerMax: 0,
      pioneerMax: 0,
      mineralMinerMax: 0,
      labTechMax: 0
    }
  },
  4: {
    economyMode: 'storage',
    spawnOrder: LOCAL_ECONOMY_SPAWN_ORDER,
    population: {
      harvesterMin: 0,
      harvesterMax: 4,
      minersPerSource: 1,
      haulersPerSource: 1.5,
      linkedHaulersPerSource: 1,
      builderMax: 1,
      upgraderMax: 2,
      guardMax: 2,
      scoutMax: 0,
      reserverPerRemote: 0,
      remoteMinerPerSource: 0,
      remoteHaulerPerSource: 0,
      claimerMax: 0,
      pioneerMax: 0,
      mineralMinerMax: 0,
      labTechMax: 0
    }
  },
  5: {
    economyMode: 'link',
    spawnOrder: LOCAL_ECONOMY_SPAWN_ORDER,
    population: {
      harvesterMin: 0,
      harvesterMax: 4,
      minersPerSource: 1,
      haulersPerSource: 1.5,
      linkedHaulersPerSource: 0.5,
      builderMax: 1,
      upgraderMax: 2,
      guardMax: 2,
      scoutMax: 1,
      reserverPerRemote: 1,
      remoteMinerPerSource: 1,
      remoteHaulerPerSource: 1,
      claimerMax: 0,
      pioneerMax: 0,
      mineralMinerMax: 0,
      labTechMax: 0
    }
  },
  6: {
    economyMode: 'terminal-remote',
    spawnOrder: LOCAL_ECONOMY_SPAWN_ORDER,
    population: {
      harvesterMin: 0,
      harvesterMax: 4,
      minersPerSource: 1,
      haulersPerSource: 1,
      linkedHaulersPerSource: 0.5,
      builderMax: 1,
      upgraderMax: 2,
      guardMax: 2,
      scoutMax: 1,
      reserverPerRemote: 1,
      remoteMinerPerSource: 1,
      remoteHaulerPerSource: 1,
      claimerMax: 1,
      pioneerMax: 4,
      mineralMinerMax: 1,
      labTechMax: 1
    }
  },
  7: {
    economyMode: 'expansion',
    spawnOrder: LOCAL_ECONOMY_SPAWN_ORDER,
    population: {
      harvesterMin: 0,
      harvesterMax: 4,
      minersPerSource: 1,
      haulersPerSource: 1,
      linkedHaulersPerSource: 0.5,
      builderMax: 1,
      upgraderMax: 2,
      guardMax: 2,
      scoutMax: 1,
      reserverPerRemote: 1,
      remoteMinerPerSource: 1,
      remoteHaulerPerSource: 1,
      claimerMax: 1,
      pioneerMax: 4,
      mineralMinerMax: 1,
      labTechMax: 1
    }
  },
  8: {
    economyMode: 'endgame',
    spawnOrder: LOCAL_ECONOMY_SPAWN_ORDER,
    population: {
      harvesterMin: 0,
      harvesterMax: 4,
      minersPerSource: 1,
      haulersPerSource: 1,
      linkedHaulersPerSource: 0.5,
      builderMax: 1,
      upgraderMax: 1,
      guardMax: 2,
      scoutMax: 1,
      reserverPerRemote: 1,
      remoteMinerPerSource: 1,
      remoteHaulerPerSource: 1,
      claimerMax: 1,
      pioneerMax: 4,
      mineralMinerMax: 1,
      labTechMax: 1
    }
  }
};

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function normalizeRcl(rcl) {
  const numeric = Number(rcl) || 1;
  return clamp(Math.floor(numeric), 1, 8);
}

function getPolicy(rcl) {
  return RCL_POLICIES[normalizeRcl(rcl)];
}

function getFallbackReasons(context) {
  const input = context || {};
  const reasons = [];

  if (
    input.bootstrapEconomy ||
    input.noCreeps ||
    input.selfHarvestMissing
  ) {
    reasons.push(FALLBACK.BOOTSTRAP);
  }
  if (
    input.energyStarved ||
    input.minersHealthy === false ||
    input.haulersHealthy === false
  ) {
    reasons.push(FALLBACK.ECONOMY_RECOVERY);
  }
  if (input.controllerEmergency) {
    reasons.push(FALLBACK.CONTROLLER_EMERGENCY);
  }
  if ((input.hostilesCount || 0) > 0) {
    reasons.push(FALLBACK.DEFENSE);
  }

  return reasons;
}

function createRole(target, limit) {
  const safeLimit = Math.max(0, Math.floor(limit || 0));
  return {
    target: clamp(Math.ceil(target || 0), 0, safeLimit),
    limit: safeLimit
  };
}

function getBuilderBoostSettings(roomName) {
  if (
    !roomName ||
    typeof Memory === 'undefined' ||
    !Memory.rooms ||
    !Memory.rooms[roomName]
  ) {
    return {
      enabled: false,
      extra: 0
    };
  }

  const raw = Memory.rooms[roomName].builderBoost;
  if (!raw || raw.enabled !== true) {
    return {
      enabled: false,
      extra: 0
    };
  }

  return {
    enabled: true,
    extra: Math.max(0, Math.floor(raw.extra || 0))
  };
}

function getPlan(rcl, context) {
  const level = normalizeRcl(rcl);
  const input = context || {};
  const policy = getPolicy(level);
  const config = policy.population;
  const builderBoost = getBuilderBoostSettings(input.roomName);
  const builderLimit = config.builderMax + builderBoost.extra;
  const sourceCount = Math.max(0, input.sourceCount || 0);
  const readySourceCount = Math.max(
    0,
    input.readySourceCount === undefined
      ? sourceCount
      : input.readySourceCount
  );
  const uncoveredSourceCount = Math.max(
    0,
    input.uncoveredSourceCount === undefined
      ? Math.max(0, sourceCount - readySourceCount)
      : input.uncoveredSourceCount
  );
  const sourceSlots = Math.max(0, input.sourceSlots || 0);
  const remoteRoomCount = Math.max(0, input.remoteRoomCount || 0);
  const remoteSourceCount = Math.max(0, input.remoteSourceCount || 0);
  const fallbackReasons = getFallbackReasons(input);
  const primaryFallback = fallbackReasons[0] || FALLBACK.NONE;
  const recoveryActive =
    fallbackReasons.indexOf(FALLBACK.BOOTSTRAP) !== -1 ||
    fallbackReasons.indexOf(FALLBACK.ECONOMY_RECOVERY) !== -1;
  let harvesterTarget = 0;

  if (level === 1 || input.bootstrapEconomy) {
    harvesterTarget = sourceSlots > 0
      ? clamp(sourceSlots, config.harvesterMin, config.harvesterMax)
      : 0;
  } else {
    harvesterTarget = Math.min(
      config.harvesterMax,
      Math.max(uncoveredSourceCount, recoveryActive ? 1 : 0)
    );
  }

  const minerTarget = Math.ceil(
    readySourceCount * config.minersPerSource
  );
  const minerLimit = minerTarget + readySourceCount;
  const haulerRatio = input.linkEconomyReady
    ? config.linkedHaulersPerSource
    : config.haulersPerSource;
  const baselineHaulerTarget = readySourceCount > 0
    ? Math.max(1, Math.ceil(readySourceCount * haulerRatio))
    : 0;
  const haulerTarget = Math.max(
    baselineHaulerTarget,
    Math.ceil(input.haulerTarget || 0)
  );
  const haulerLimit = haulerTarget > 0 ? haulerTarget + 1 : 0;
  const needsBuilder = !!(
    input.emergencyRepair ||
    input.constructionCount > 0 ||
    (input.generalRepair && !input.towersCanMaintain)
  );
  const requestedUpgradeWork = Math.max(
    0,
    input.upgraderWorkTarget || 0
  );
  const upgradeSuspended =
    FALLBACK_PROFILES[primaryFallback].suspendUpgrade &&
    !input.controllerEmergency;
  const upgraderWorkTarget = upgradeSuspended
    ? 0
    : requestedUpgradeWork;

  const roles = {
    rcl1Harvester: createRole(
      harvesterTarget,
      config.harvesterMax
    ),
    rcl2Miner: createRole(minerTarget, minerLimit),
    rcl2Hauler: createRole(haulerTarget, haulerLimit),
    rcl1Builder: createRole(
      needsBuilder ? builderLimit : 0,
      builderLimit
    ),
    rcl1Upgrader: createRole(
      upgraderWorkTarget > 0 ? 1 : 0,
      config.upgraderMax
    ),
    guard: createRole(
      input.hostilesCount > 0 ? config.guardMax : 0,
      config.guardMax
    ),
    scout: createRole(
      input.remoteProgramActive ? config.scoutMax : 0,
      config.scoutMax
    ),
    reserver: createRole(
      remoteRoomCount * config.reserverPerRemote,
      remoteRoomCount * config.reserverPerRemote
    ),
    remoteMiner: createRole(
      remoteSourceCount * config.remoteMinerPerSource,
      remoteSourceCount * config.remoteMinerPerSource
    ),
    remoteHauler: createRole(
      remoteSourceCount * config.remoteHaulerPerSource,
      remoteSourceCount * config.remoteHaulerPerSource + (
        remoteSourceCount > 0 ? 1 : 0
      )
    ),
    claimer: createRole(
      input.expansionActive ? config.claimerMax : 0,
      config.claimerMax
    ),
    pioneer: createRole(
      input.expansionActive ? config.pioneerMax : 0,
      config.pioneerMax
    ),
    mineralMiner: createRole(
      input.mineralActive ? config.mineralMinerMax : 0,
      config.mineralMinerMax
    ),
    labTech: createRole(
      input.labsActive ? config.labTechMax : 0,
      config.labTechMax
    )
  };

  return {
    version: POLICY_VERSION,
    rcl: level,
    economyMode: policy.economyMode,
    builderBoost: builderBoost,
    fallback: primaryFallback,
    fallbackActive: primaryFallback !== FALLBACK.NONE,
    fallbackReasons: fallbackReasons,
    spawnOrder: (
      primaryFallback === FALLBACK.NONE
        ? policy.spawnOrder
        : FALLBACK_PROFILES[primaryFallback].spawnOrder
    ).slice(),
    upgraderWorkTarget: upgraderWorkTarget,
    roles: roles
  };
}

function getRole(plan, role) {
  if (!plan || !plan.roles || !plan.roles[role]) {
    return { target: 0, limit: 0 };
  }

  return plan.roles[role];
}

function getRoleLimit(role, readySourceCount, rcl) {
  return getRole(
    getPlan(rcl || 2, {
      sourceCount: readySourceCount || 0,
      readySourceCount: readySourceCount || 0
    }),
    role
  ).limit;
}

function getLimits(readySourceCount, rcl) {
  const plan = getPlan(rcl || 2, {
    sourceCount: readySourceCount || 0,
    readySourceCount: readySourceCount || 0
  });
  const limits = {};

  for (const role in plan.roles) {
    limits[role] = plan.roles[role].limit;
  }

  return limits;
}

function saveRoomState(roomName, plan) {
  if (!roomName || !plan || typeof Memory === 'undefined') return;
  if (!Memory.rooms) Memory.rooms = {};
  if (!Memory.rooms[roomName]) Memory.rooms[roomName] = {};

  const targets = {};
  const limits = {};
  for (const role in plan.roles) {
    targets[role] = plan.roles[role].target;
    limits[role] = plan.roles[role].limit;
  }

  Memory.rooms[roomName].populationPolicy = {
    version: plan.version,
    rcl: plan.rcl,
    economyMode: plan.economyMode,
    builderBoost: plan.builderBoost,
    fallback: plan.fallback,
    fallbackActive: plan.fallbackActive,
    fallbackReasons: plan.fallbackReasons.slice(),
    spawnOrder: plan.spawnOrder.slice(),
    upgraderWorkTarget: plan.upgraderWorkTarget,
    targets: targets,
    limits: limits,
    updatedAt: Game.time
  };
}

module.exports = {
  FALLBACK: FALLBACK,
  FALLBACK_PROFILES: FALLBACK_PROFILES,
  POLICY_VERSION: POLICY_VERSION,
  RCL_POLICIES: RCL_POLICIES,
  getLimits: getLimits,
  getPlan: getPlan,
  getPolicy: getPolicy,
  getRole: getRole,
  getRoleLimit: getRoleLimit,
  saveRoomState: saveRoomState
};
