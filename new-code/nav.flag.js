// Flag-based navigation system.
// Player places flags named nav-0, nav-1, nav-2, ..., nav-N to
// define a waypoint path from spawn to expansion target.
// Creeps follow them in order; after the last flag they fall
// back to normal room-center navigation.
module.exports = {
  // Returns sorted nav flags [{ index, pos, name }] or empty array.
  getPath: function () {
    const flags = [];
    for (const flagName in Game.flags) {
      const match = flagName.match(/^nav-(\d+)$/);
      if (match) {
        flags.push({
          index: parseInt(match[1], 10),
          pos: Game.flags[flagName].pos,
          name: flagName
        });
      }
    }
    flags.sort(function (a, b) { return a.index - b.index; });
    return flags;
  },

  // Follow the flag chain toward targetRoom.
  // Returns true if the creep moved toward a flag (caller should return).
  // Returns false if no flags exist or all flags have been passed —
  //   caller should fall back to normal room-center movement.
  moveToTarget: function (creep, targetRoom) {
    var path = this.getPath();
    if (path.length === 0) return false;

    // Find the first flag we haven't reached yet (range ≤ 1 in same room)
    for (var i = 0; i < path.length; i++) {
      var flag = path[i];

      // Same room AND within 1 tile → reached this flag
      if (
        creep.pos.roomName === flag.pos.roomName &&
        creep.pos.inRangeTo(flag.pos, 1)
      ) {
        continue;
      }

      // Flag is in a different room — navigate to that room's center first
      if (creep.pos.roomName !== flag.pos.roomName) {
        creep.moveTo(
          new RoomPosition(25, 25, flag.pos.roomName),
          { reusePath: 20, visualizePathStyle: { stroke: '#ffaa00' } }
        );
        return true;
      }

      // Same room, not yet at flag — navigate directly
      creep.moveTo(flag.pos, {
        reusePath: 5,
        visualizePathStyle: { stroke: '#ffaa00' }
      });
      return true;
    }

    // Past all flags
    return false;
  }
};
