const rcl1Bootstrap = require('manager.rcl1Bootstrap');
const rcl2ContainerEconomy = require('manager.rcl2ContainerEconomy');
const roleRcl1Harvester = require('role.rcl1Harvester');
const roleUpgrader = require('role.upgrader');
const roleRcl1Builder = require('role.rcl1Builder');
const roleRcl2Miner = require('role.rcl2Miner');
const roleRcl2Hauler = require('role.rcl2Hauler');
const roleRemoteMiner = require('role.remoteMiner');
const roleRemoteHauler = require('role.remoteHauler');
const roleRemoteBuilder = require('role.remoteBuilder');
const roleReserver = require('role.reserver');
const roleRcl1Claimer = require('role.claimer');
const rolePioneer = require('role.pioneer');
const roleGuard = require('role.guard');
const roleRemoteGuard = require('role.remoteGuard');
const roleSquadMelee = require('role.squadMelee');
const roleSquadHealer = require('role.squadHealer');
const roleSquadRanged = require('role.squadRanged');
const military = require('manager.military');
const remote = require('manager.remote');
const remoteDefense = require('manager.remoteDefense');
const stats = require('manager.stats');
const intel = require('manager.intel');
const errorReporter = require('core.errorReporter');
const rcl1SourceSlots = require('manager.rcl1SourceSlots');
const towerManager = require('manager.tower');
const roomPlanner = require('planner.roomPlanner');
const construction = require('manager.construction');
const linkManager = require('manager.link');
const frontBasePlanner = require('planner.frontBase');
const ROOM_PLANNER_ENABLED = false;
const ROOM_PLANNER_ACTIVATION_VERSION = 1;

const LEGACY_ROLES = {
  harvester: 'rcl1Harvester',
  builder: 'rcl1Builder',
  rcl1Upgrader: 'upgrader'
};

const ROLE_MODULES = {
  rcl1Harvester: roleRcl1Harvester,
  upgrader: roleUpgrader,
  rcl1Builder: roleRcl1Builder,
  rcl2Miner: roleRcl2Miner,
  rcl2Hauler: roleRcl2Hauler,
  remoteMiner: roleRemoteMiner,
  remoteHauler: roleRemoteHauler,
  remoteBuilder: roleRemoteBuilder,
  reserver: roleReserver,
  claimer: roleRcl1Claimer,
  pioneer: rolePioneer,
  guard: roleGuard,
  remoteGuard: roleRemoteGuard,
  squadMelee: roleSquadMelee,
  squadHealer: roleSquadHealer,
  squadRanged: roleSquadRanged
};

function runBootstrapFallback(room) {
  try {
    rcl1Bootstrap.run(room);
  } catch (err) {
    errorReporter.capture(err, {
      module: 'manager.rcl1Bootstrap',
      room: room.name
    });
  }
}

function shouldAutoPlanFrontBase(room) {
  if (!room || !room.controller || !room.controller.my) return false;

  var spawns = room.find(FIND_MY_SPAWNS);
  if (spawns.length === 0) return false;

  var mission = Memory.expansionMission;
  if (
    mission &&
    mission.targetRoom === room.name &&
    mission.phase !== 'done'
  ) {
    return true;
  }

  return room.name === 'W47N22';
}

function activateRoomPlanner(roomName) {
  if (!Memory.rooms) Memory.rooms = {};
  if (!Memory.rooms[roomName]) Memory.rooms[roomName] = {};

  const roomMemory = Memory.rooms[roomName];
  if (
    roomMemory.plannerActivationVersion ===
    ROOM_PLANNER_ACTIVATION_VERSION
  ) {
    return;
  }
  if (!roomMemory.planner) roomMemory.planner = {};

  roomMemory.planner.enabled = true;
  roomMemory.planner.forceReplan = true;
  roomMemory.plannerActivationVersion =
    ROOM_PLANNER_ACTIVATION_VERSION;
}

module.exports.loop = function () {
  try {
    military.update(false);
  } catch (err) {
    errorReporter.capture(err, {
      module: 'manager.military.update'
    });
  }

  // 1. 清掉已死亡 creep 的 Memory，避免 Memory 越來越髒
  for (const name in Memory.creeps) {
    if (!Game.creeps[name]) {
      rcl1SourceSlots.releaseCreep(name);
      delete Memory.creeps[name];
      console.log('[memory] cleared dead creep:', name);
    }
  }

  // 舊角色就地遷移，避免切換 manager 後現存 creep 停擺。
  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    if (LEGACY_ROLES[creep.memory.role]) {
      creep.memory.role = LEGACY_ROLES[creep.memory.role];
    }
  }

  // 2. Remote spawning: run FIRST so remote creeps get spawn priority.
  // isHomeEconomyStable ensures home economy is healthy before we steal the spawn.
  try {
    remoteDefense.run();
    remote.run();

    const defenseRequests = remoteDefense.getAllSpawnRequests('W49N25');
    if (defenseRequests.length > 0) {
      const homeRoom = Game.rooms['W49N25'];
      if (homeRoom) {
        const spawn = homeRoom.find(FIND_MY_SPAWNS)[0];
        if (spawn && !spawn.spawning) {
          const req = defenseRequests[0];
          if (homeRoom.energyAvailable >= req.bodyCost) {
            const result = spawn.spawnCreep(req.body, req.name, {
              memory: req.memory
            });
            if (result === OK) {
              console.log('[defense] spawned ' + req.name);
            }
          }
        }
      }
    }
  } catch (err) {
    errorReporter.capture(err, {
      module: 'manager.remote'
    });
  }

  // 3. 每個 room 先更新 container economy，再選 RCL1/RCL2 manager。
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    let economyState;

    if (Game.time % 20 === 0) {
      rcl1SourceSlots.cleanup(room);
    }

    try {
      towerManager.run(room);
    } catch (err) {
      errorReporter.capture(err, {
        module: 'manager.tower',
        room: roomName
      });
    }

    if (ROOM_PLANNER_ENABLED) {
      try {
        activateRoomPlanner(roomName);
        roomPlanner.run(room);
      } catch (err) {
        errorReporter.capture(err, {
          module: 'planner.roomPlanner',
          room: roomName
        });
      }
    }

    // Front-base construction: place sites from Memory.rooms[name].plan
    try {
      var plan = Memory.rooms && Memory.rooms[roomName] && Memory.rooms[roomName].plan;
      if (!plan && shouldAutoPlanFrontBase(room)) {
        plan = frontBasePlanner.init(roomName);
      }
      if (plan && plan.type === 'frontBase') {
        construction.run(roomName);
      }
    } catch (err) {
      errorReporter.capture(err, {
        module: 'manager.construction',
        room: roomName
      });
    }

    try {
      economyState = rcl2ContainerEconomy.collect(room);
    } catch (err) {
      errorReporter.capture(err, {
        module: 'manager.rcl2ContainerEconomy.collect',
        room: roomName
      });
      runBootstrapFallback(room);
      continue;
    }

    if (!economyState.ready) {
      runBootstrapFallback(room);
      continue;
    }

    try {
      rcl2ContainerEconomy.run(room, economyState);
    } catch (err) {
      errorReporter.capture(err, {
        module: 'manager.rcl2ContainerEconomy.run',
        room: roomName
      });
      runBootstrapFallback(room);
    }

    try {
      military.trySpawn(room);
    } catch (err) {
      errorReporter.capture(err, {
        module: 'manager.military.trySpawn',
        room: roomName
      });
    }
  }

  // 4. 執行每隻 creep 的 role
  for (const name in Game.creeps) {
    const creep = Game.creeps[name];

    try {
      const roleModule = ROLE_MODULES[creep.memory.role];
      if (roleModule) {
        roleModule.run(creep);
      } else {
        console.log('[warn] unknown role:', creep.name, creep.memory.role);
      }
    } catch (err) {
      errorReporter.capture(err, {
        module: `role.${creep.memory.role || 'unknown'}`,
        role: creep.memory.role,
        room: creep.room.name,
        creep: creep.name,
        state: creep.memory.state !== undefined
          ? creep.memory.state
          : creep.memory.working
      });
    }
  }

  // 5. 每 20 tick 輸出給 Codex / 外部 agent 看的狀態
  if (Game.time % 20 === 0) {
    stats.collect();
  }

  // 6. 每 100 tick 記錄目前有視野的房間態勢
  if (Game.time % 100 === 0) {
    try {
      intel.collectVisibleRooms();
    } catch (err) {
      errorReporter.capture(err, {
        module: 'manager.intel'
      });
    }
  }

  // 7. Link manager: three-link dynamic balancing (W49N25)
  try {
    var w49n25 = Game.rooms['W49N25'];
    if (w49n25) {
      linkManager.run(w49n25);
    }
  } catch (err) {
    errorReporter.capture(err, { module: 'manager.link' });
  }
};
