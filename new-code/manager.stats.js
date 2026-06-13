const rcl1SourceSlots = require('manager.rcl1SourceSlots');

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
      const roleCounts = {};
      const roomMemory = Memory.rooms && Memory.rooms[roomName]
        ? Memory.rooms[roomName]
        : {};
      const sourceMemory = roomMemory.sources || {};
      const sources = [];
      const sourceContainers = [];
      const slotStats = rcl1SourceSlots.getStats(room);
      const economyAccounting = roomMemory.economyAccounting || {};

      for (const creep of creeps) {
        const role = creep.memory.role || 'unknown';
        roleCounts[role] = (roleCounts[role] || 0) + 1;
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

      Memory.agent.rooms[roomName] = {
        energyAvailable: room.energyAvailable,
        energyCapacityAvailable: room.energyCapacityAvailable,
        controllerLevel: room.controller ? room.controller.level : 0,
        controllerProgress: room.controller ? room.controller.progress : 0,
        controllerProgressTotal: room.controller ? room.controller.progressTotal : 0,
        economyMode: roomMemory.containerEconomy
          ? roomMemory.containerEconomy.mode || 'rcl1-bootstrap'
          : 'rcl1-bootstrap',
        economyAccounting: {
          shortIncomeRate: economyAccounting.shortIncomeRate || 0,
          longIncomeRate: economyAccounting.longIncomeRate || 0,
          incomeRate: economyAccounting.incomeRate || 0,
          replacementRate: economyAccounting.replacementRate || 0,
          upgradeRate: economyAccounting.upgradeRate || 0,
          upgraderWorkTarget:
            economyAccounting.upgraderWorkTarget || 0,
          upgradeCredits: economyAccounting.upgradeCredits || 0,
          recovery: !!economyAccounting.recovery,
          controllerEmergency:
            !!economyAccounting.controllerEmergency,
          totalHarvested: economyAccounting.totalHarvested || 0,
          totalUpgradeSpent:
            economyAccounting.totalUpgradeSpent || 0
        },
        rcl1SourceSlots: slotStats,
        roleCounts: roleCounts,
        myCreeps: creeps.length,
        hostiles: room.find(FIND_HOSTILE_CREEPS).length,
        sources: sources,
        sourceContainers: sourceContainers,
        constructionSites: room.find(FIND_MY_CONSTRUCTION_SITES).length,
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
