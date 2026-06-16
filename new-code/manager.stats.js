const bodyPolicy = require('body.policy');
const rcl1SourceSlots = require('manager.rcl1SourceSlots');
const population = require('manager.population');

module.exports = {
  collect: function () {
    Memory.agent = {
      tick: Game.time,
      rooms: {},
      creeps: {},
      cpu: {
        limit: Game.cpu.limit,
        tickLimit: Game.cpu.tickLimit,
        bucket: Game.cpu.bucket,
        used: 0
      }
    };

    for (const roomName in Game.rooms) {
      const room = Game.rooms[roomName];
      const creeps = room.find(FIND_MY_CREEPS);
      const constructionSites = room.find(FIND_MY_CONSTRUCTION_SITES);
      const constructionSiteCount = constructionSites.length;
      let remainingBuildWork = 0;
      for (let i = 0; i < constructionSites.length; i++) {
        remainingBuildWork += Math.max(
          0,
          constructionSites[i].progressTotal -
            constructionSites[i].progress
        );
      }
      const hostileCount = room.find(FIND_HOSTILE_CREEPS).length;
      const roleCounts = {};
      const roomMemory = Memory.rooms && Memory.rooms[roomName]
        ? Memory.rooms[roomName]
        : {};
      const sourceMemory = roomMemory.sources || {};
      const sources = [];
      const sourceContainers = [];
      const slotStats = rcl1SourceSlots.getStats(room);
      const economyAccounting = roomMemory.economyAccounting || {};
      const planner = roomMemory.planner || {};
      let upgraderCount = 0;
      let upgraderWork = 0;
      let haulerCount = 0;
      let haulerCarryParts = 0;

      for (const creep of creeps) {
        const role = creep.memory.role || 'unknown';
        roleCounts[role] = (roleCounts[role] || 0) + 1;
        if (role === 'rcl1Upgrader') {
          upgraderCount++;
          upgraderWork += creep.getActiveBodyparts(WORK);
        }
        if (role === 'rcl2Hauler') {
          haulerCount++;
          haulerCarryParts += creep.getActiveBodyparts(CARRY);
        }
      }

      for (const sourceId in sourceMemory) {
        const entry = sourceMemory[sourceId];

        sources.push({
          sourceId: sourceId,
          containerId: entry.containerId || null,
          containerPos: entry.containerPos || null,
          containerReady: !!entry.containerReady,
          minerName: entry.minerName || null,
          distanceFromSpawn: typeof entry.distanceFromSpawn === 'number'
            ? entry.distanceFromSpawn
            : null,
          suggestedContainerPos: entry.suggestedContainerPos || null
        });

        if (entry.containerReady && entry.containerId) {
          const container = Game.getObjectById(entry.containerId);
          if (container) {
            sourceContainers.push({
              id: container.id,
              x: container.pos.x,
              y: container.pos.y,
              energy: container.store.getUsedCapacity(RESOURCE_ENERGY),
              capacity: container.store.getCapacity(RESOURCE_ENERGY)
            });
          }
        }
      }

      sources.sort((left, right) => left.sourceId.localeCompare(right.sourceId));
      sourceContainers.sort((left, right) => left.id.localeCompare(right.id));
      const readySourceCount = sources.filter(
        source => source.containerReady
      ).length;
      const controllerLevel = room.controller ? room.controller.level : 1;
      const savedPopulationPolicy = roomMemory.populationPolicy || {};
      const savedHaulerPlan = roomMemory.containerEconomy &&
        roomMemory.containerEconomy.haulerPlan
        ? roomMemory.containerEconomy.haulerPlan
        : {};
      const plannedUpgraderBody =
        (economyAccounting.upgraderWorkTarget || 0) > 0
          ? bodyPolicy.buildStaticUpgraderBody(
            room.energyCapacityAvailable,
            economyAccounting.upgraderWorkTarget
          )
          : [];
      const plannedUpgraderWork = plannedUpgraderBody.filter(
        part => part === WORK
      ).length;
      // Remote program context for this room
      const remoteHomeCfg = Memory.remote && Memory.remote[roomName];
      const remoteRoomsCfg = remoteHomeCfg && remoteHomeCfg.rooms ? remoteHomeCfg.rooms : {};
      let remoteRoomCnt = 0;
      let remoteSourceCnt = 0;
      for (const rn in remoteRoomsCfg) {
        const rc = remoteRoomsCfg[rn];
        if (!rc || rc.enabled === false) continue;
        remoteRoomCnt++;
        if (Array.isArray(rc.sources)) {
          remoteSourceCnt += rc.sources.filter(function (s) {
            return s && s.enabled !== false && s.x !== null && s.y !== null;
          }).length;
        }
      }
      const remoteActive = remoteRoomCnt > 0;

      const fallbackPlan = population.getPlan(controllerLevel, {
        constructionCount: constructionSiteCount,
        remainingBuildWork: remainingBuildWork,
        controllerEmergency:
          !!economyAccounting.controllerEmergency,
        energyStarved: !!(
          roomMemory.containerEconomy &&
          roomMemory.containerEconomy.energyStarved
        ),
        hostilesCount: hostileCount,
        noCreeps: creeps.length === 0,
        readySourceCount: readySourceCount,
        remoteRoomCount: remoteRoomCnt,
        remoteSourceCount: remoteSourceCnt,
        remoteProgramActive: remoteActive,
        sourceCount: sources.length,
        sourceSlots: slotStats.totalSlots,
        uncoveredSourceCount: sources.length - readySourceCount,
        upgraderWorkTarget:
          economyAccounting.upgraderWorkTarget || 0
      });
      const roleTargets = savedPopulationPolicy.targets || {};
      const roleLimits = savedPopulationPolicy.limits || {};
      const populationState = {};
      const policyRoles = {};
      for (const role in fallbackPlan.roles) policyRoles[role] = true;
      for (const role in roleCounts) policyRoles[role] = true;

      for (const role in policyRoles) {
        const count = roleCounts[role] || 0;
        const fallbackRole = population.getRole(fallbackPlan, role);
        const target = roleTargets[role] === undefined
          ? fallbackRole.target
          : roleTargets[role];
        const limit = roleLimits[role] === undefined
          ? fallbackRole.limit
          : roleLimits[role];

        populationState[role] = {
          count: count,
          target: target,
          limit: limit,
          missing: Math.max(0, target - count),
          excess: Math.max(0, count - limit)
        };
      }

      Memory.agent.rooms[roomName] = {
        energyAvailable: room.energyAvailable,
        energyCapacityAvailable: room.energyCapacityAvailable,
        controllerLevel: controllerLevel,
        controllerProgress: room.controller ? room.controller.progress : 0,
        controllerProgressTotal: room.controller ? room.controller.progressTotal : 0,
        economyMode: roomMemory.containerEconomy
          ? roomMemory.containerEconomy.mode || 'rcl1-bootstrap'
          : 'rcl1-bootstrap',
        economyAccounting: {
          shortIncomeRate: economyAccounting.shortIncomeRate || 0,
          longIncomeRate: economyAccounting.longIncomeRate || 0,
          incomeRate: economyAccounting.incomeRate || 0,
          storedEnergy: economyAccounting.storedEnergy || 0,
          shortNetEnergyRate:
            economyAccounting.shortNetEnergyRate || 0,
          longNetEnergyRate:
            economyAccounting.longNetEnergyRate || 0,
          shortConsumptionRate:
            economyAccounting.shortConsumptionRate || 0,
          longConsumptionRate:
            economyAccounting.longConsumptionRate || 0,
          replacementRate: economyAccounting.replacementRate || 0,
          upgradeRate: economyAccounting.upgradeRate || 0,
          upgraderWorkTarget:
            economyAccounting.upgraderWorkTarget || 0,
          plannedUpgraderWork: plannedUpgraderWork,
          plannedUpgraderBodyCost:
            bodyPolicy.getBodyCost(plannedUpgraderBody),
          upgraderCount: upgraderCount,
          upgraderWork: upgraderWork,
          excessUpgraderWork: Math.max(
            0,
            upgraderWork -
              (economyAccounting.upgraderWorkTarget || 0)
          ),
          upgradeCredits: economyAccounting.upgradeCredits || 0,
          recovery: !!economyAccounting.recovery,
          controllerEmergency:
            !!economyAccounting.controllerEmergency,
          totalHarvested: economyAccounting.totalHarvested || 0,
          totalUpgradeSpent:
            economyAccounting.totalUpgradeSpent || 0
        },
        logistics: {
          haulerCount: haulerCount,
          haulerCarryParts: haulerCarryParts,
          haulerTargetCount: savedHaulerPlan.targetCount || 0,
          requiredCarryParts: savedHaulerPlan.requiredCarryParts || 0,
          targetCarryParts: savedHaulerPlan.targetCarryParts || 0,
          plannedBodyCarryParts: savedHaulerPlan.bodyCarryParts || 0,
          plannedBodyCost: savedHaulerPlan.bodyCost || 0
        },
        planner: {
          version: planner.version || null,
          enabled: planner.enabled !== false,
          anchor: planner.anchor || null,
          anchorReason: planner.anchorReason || null,
          roadStrategy: planner.roadStrategy || null,
          lastPlanned: planner.lastPlanned || null,
          lastSiteStatus: planner.lastSiteStatus || null,
          lastSite: planner.lastSite || null,
          extensions: Array.isArray(planner.extensions)
            ? planner.extensions.length
            : 0,
          roads:
            planner.roads &&
            Array.isArray(planner.roads.routeRoads) &&
            Array.isArray(planner.roads.coreRoads)
              ? planner.roads.routeRoads.length +
                planner.roads.coreRoads.length
              : 0,
          routeRoads:
            planner.roads && Array.isArray(planner.roads.routeRoads)
              ? planner.roads.routeRoads.length
              : 0,
          coreRoads:
            planner.roads && Array.isArray(planner.roads.coreRoads)
              ? planner.roads.coreRoads.length
              : 0,
          towers: Array.isArray(planner.towers)
            ? planner.towers.length
            : 0
        },
        rcl1SourceSlots: slotStats,
        roleCounts: roleCounts,
        populationPolicy: {
          version:
            savedPopulationPolicy.version || fallbackPlan.version,
          rcl: savedPopulationPolicy.rcl || fallbackPlan.rcl,
          economyMode:
            savedPopulationPolicy.economyMode ||
            fallbackPlan.economyMode,
          fallback:
            savedPopulationPolicy.fallback || fallbackPlan.fallback,
          fallbackActive:
            savedPopulationPolicy.fallbackActive === undefined
              ? fallbackPlan.fallbackActive
              : savedPopulationPolicy.fallbackActive,
          fallbackReasons:
            savedPopulationPolicy.fallbackReasons ||
            fallbackPlan.fallbackReasons,
          spawnOrder:
            savedPopulationPolicy.spawnOrder ||
            fallbackPlan.spawnOrder,
          upgraderWorkTarget:
            savedPopulationPolicy.upgraderWorkTarget === undefined
              ? fallbackPlan.upgraderWorkTarget
              : savedPopulationPolicy.upgraderWorkTarget,
          updatedAt: savedPopulationPolicy.updatedAt || null
        },
        population: populationState,
        myCreeps: creeps.length,
        hostiles: hostileCount,
        sources: sources,
        sourceContainers: sourceContainers,
        constructionSites: constructionSiteCount,
        spawns: room.find(FIND_MY_SPAWNS).map(s => ({
          name: s.name,
          spawning: !!s.spawning,
          energy: s.store.getUsedCapacity(RESOURCE_ENERGY)
        }))
      };
    }

    for (const name in Game.creeps) {
      const creep = Game.creeps[name];

      Memory.agent.creeps[name] = {
        role: creep.memory.role,
        home: creep.memory.home,
        room: creep.room.name,
        ticksToLive: creep.ticksToLive,
        working: creep.memory.working,
        task: creep.memory.task || null,
        energy: creep.store.getUsedCapacity(RESOURCE_ENERGY),
        capacity: creep.store.getCapacity()
      };
    }

    Memory.agent.cpu.used = Game.cpu.getUsed();
    console.log('[agent] state updated at tick', Game.time);
  }
};
