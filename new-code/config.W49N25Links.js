/**
 * config.W49N25Links.js — W49N25 Remote Energy Gateway configuration
 *
 * Door Link:   6a365015c5a7673e2ea6a3d0  pos 47,6
 * Upgrader Link: 6a3a1ef8a2efc749fc787c05
 * Storage Link:  6a3a94f8c4735e6f3cac3b14  (note: was 6a3a1b8cd95da3a3fde03bb5)
 *
 * Door buffer containers: 46,6 and 48,6
 */

var W49N25_LINK_CONFIG = {
  roomName: 'W49N25',

  doorLinkId: '6a365015c5a7673e2ea6a3d0',
  upgraderLinkId: '6a3a1ef8a2efc749fc787c05',
  storageLinkId: '6a3a94f8c4735e6f3cac3b14',

  receiverThresholdRatio: 0.10,

  doorBalancer: {
    role: 'doorLinkBalancer',
    fixedPos: { roomName: 'W49N25', x: 47, y: 7 },
    body: [CARRY, CARRY, MOVE],
    leftContainerPos: { x: 46, y: 6 },
    rightContainerPos: { x: 48, y: 6 }
  },

  storageBalancer: {
    role: 'storageLinkBalancer',
    fixedPos: { roomName: 'W49N25', x: 17, y: 28 },
    body: [CARRY, CARRY]
  },

  restrictedRemoteRooms: ['W48N25', 'W48N26']
};

module.exports = W49N25_LINK_CONFIG;
