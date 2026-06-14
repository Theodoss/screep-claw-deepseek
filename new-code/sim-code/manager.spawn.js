function countRole(room, role) {
  return room.find(FIND_MY_CREEPS).filter(c => c.memory.role === role).length;
}

function selectSourceId(room) {
  const sources = room.find(FIND_SOURCES);
  if (sources.length === 0) return undefined;

  const assignmentCounts = {};
  for (const source of sources) {
    assignmentCounts[source.id] = 0;
  }

  const creeps = room.find(FIND_MY_CREEPS);
  for (const creep of creeps) {
    if (assignmentCounts[creep.memory.sourceId] !== undefined) {
      assignmentCounts[creep.memory.sourceId]++;
    }
  }

  let selected = sources[0];
  for (const source of sources) {
    if (assignmentCounts[source.id] < assignmentCounts[selected.id]) {
      selected = source;
    }
  }

  return selected.id;
}

function trySpawn(spawn, role, body, sourceId) {
  const name = `${role}-${spawn.room.name}-${spawn.name}-${Game.time}`;
  const result = spawn.spawnCreep(body, name, {
    memory: {
      role: role,
      home: spawn.room.name,
      working: false,
      sourceId: sourceId
    }
  });

  if (result === OK) {
    console.log(`[spawn] ${spawn.name} spawning ${name}`);
  } else if (result !== ERR_NOT_ENOUGH_ENERGY && result !== ERR_BUSY) {
    console.log(`[spawn:error] role=${role} result=${result}`);
  }

  return result;
}

module.exports = {
  run: function (room) {
    const spawns = room.find(FIND_MY_SPAWNS);
    if (spawns.length === 0) return;

    const spawn = spawns[0];
    if (spawn.spawning) return;

    const harvesters = countRole(room, 'harvester');
    const upgraders = countRole(room, 'upgrader');
    const builders = countRole(room, 'builder');
    const sites = room.find(FIND_MY_CONSTRUCTION_SITES, {
      filter: site => site.structureType !== STRUCTURE_WALL
    });

    // RCL1 / early RCL2 基本身體，成本 200
    const basicBody = [WORK, CARRY, MOVE];

    // 緊急恢復：如果完全沒有 harvester，一有 200 energy 就先生 harvester
    if (harvesters < 2) {
      trySpawn(spawn, 'harvester', basicBody, selectSourceId(room));
      return;
    }

    if (sites.length > 0 && builders < 1) {
      trySpawn(spawn, 'builder', basicBody, selectSourceId(room));
      return;
    }

    if (upgraders < 1) {
      trySpawn(spawn, 'upgrader', basicBody, selectSourceId(room));
      return;
    }

    // 有建築任務時，現有後勤 creep 全部投入，不再追加 upgrader。
    if (sites.length > 0) return;

    // 能量滿了就多生 upgrader，把能量轉成 controller progress
    if (room.energyAvailable >= room.energyCapacityAvailable && upgraders < 3) {
      trySpawn(spawn, 'upgrader', basicBody, selectSourceId(room));
      return;
    }
  }
};
