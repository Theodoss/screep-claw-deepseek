// ── Shared spawn selection ───────────────────────────────────────────────
// Returns the first spawn in the room that is NOT currently spawning, or
// null if every spawn is busy (or the room has none).
//
// Using this everywhere (instead of the old `spawns[0]` + `spawn.spawning`
// bail) lets RCL7+ rooms with 2–3 spawns run them in parallel: the managers
// that spawn each tick run in sequence (remote → defense → economy →
// military), and because a spawn becomes `.spawning` the instant spawnCreep
// succeeds, each subsequent caller naturally grabs the next free spawn.
// In a single-spawn room behaviour is unchanged. See DECISIONS D011 (B2).
function getAvailableSpawn(room) {
  if (!room) return null;
  const spawns = room.find(FIND_MY_SPAWNS);
  for (let index = 0; index < spawns.length; index++) {
    if (!spawns[index].spawning) return spawns[index];
  }
  return null;
}

function getSpawns(room) {
  return room ? room.find(FIND_MY_SPAWNS) : [];
}

module.exports = {
  getAvailableSpawn: getAvailableSpawn,
  getSpawns: getSpawns
};
