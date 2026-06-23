// ── Colony table (殖民地表) ──────────────────────────────────────────────
// Single source of truth for which rooms we own as colony homes, the
// remote-mining rooms each home runs, and (future) per-colony expansion
// intent. Groundwork for multi-colony support — see DECISIONS D010 and the
// B1 finding in REVIEW_2026-06-22.md (home room was hardcoded as 'W49N25').
//
// To add a colony after claiming a room:
//   1. claim + build its spawn (expansion mission, DECISIONS D008)
//   2. add an entry here keyed by the home room name, with its remotes
// manager.remote.js iterates listHomeRooms(), so no code change is needed
// there — just this table.
//
// Source entry shape (per remote room):
//   { id, x, y, roomName, containerX, containerY, enabled }
//   x/y          = source tile (auto-corrected on first vision if slightly off)
//   containerX/Y = where the source container sits (adjacent non-wall tile)
//   enabled      = whether to actively mine this source

const COLONIES = {
  W49N25: {
    home: 'W49N25',
    // remote rooms keyed by room name → array of source configs
    remotes: {
      W49N26: [
        { id: null, x: 16, y: 26, roomName: 'W49N26', containerX: 16, containerY: 25, enabled: true },
        { id: null, x: 23, y: 25, roomName: 'W49N26', containerX: 23, containerY: 24, enabled: true }
      ],
      W48N25: [
        { id: null, x: 29, y: 23, roomName: 'W48N25', containerX: 28, containerY: 22, enabled: false },
        { id: null, x: 41, y: 3, roomName: 'W48N25', containerX: 42, containerY: 3, enabled: false }
      ],
      W48N26: [
        { id: null, x: 12, y: 38, roomName: 'W48N26', containerX: 11, containerY: 38, enabled: false },
        { id: null, x: 41, y: 39, roomName: 'W48N26', containerX: 40, containerY: 38, enabled: false }
      ]
    }
    // expansion: { targetRoom, signText, builderCount }  // future: drive D008 per-colony
  }
};

// Home room names we currently operate as colonies.
function listHomeRooms() {
  return Object.keys(COLONIES);
}

function getColony(homeRoomName) {
  return COLONIES[homeRoomName] || null;
}

// Remote rooms (keyed by room name) for a given home, or {} if none.
function getRemoteRooms(homeRoomName) {
  const colony = COLONIES[homeRoomName];
  return colony && colony.remotes ? colony.remotes : {};
}

// Default source-config array for one remote room of one home.
function getDefaultSources(homeRoomName, remoteRoomName) {
  const remotes = getRemoteRooms(homeRoomName);
  return remotes[remoteRoomName] || [];
}

// Reverse lookup: which home owns a given remote room (or null).
function getHomeForRemote(remoteRoomName) {
  for (const home in COLONIES) {
    const remotes = COLONIES[home].remotes || {};
    if (remotes[remoteRoomName]) return home;
  }
  return null;
}

module.exports = {
  COLONIES: COLONIES,
  listHomeRooms: listHomeRooms,
  getColony: getColony,
  getRemoteRooms: getRemoteRooms,
  getDefaultSources: getDefaultSources,
  getHomeForRemote: getHomeForRemote
};
