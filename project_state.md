# Screeps State
🏆 RCL6 @ 0.5% (18,683/3,645,000), long march begins
incomeRate: 60.07, longNetEnergy: -6.13
upgraderWork: 29/40, upgradeRate: 40.47
13 creeps, Spawn1 spawning, extensions drained post-spawn
3 remotes active, W49N26 guard reports cleared
Last: 06/22 - D009 已部署(9532746)；D010~D012 本次推送：
- D009: travel.js 沼澤修正 + expansionMission 狀態機 (已部署)
- D010: 殖民地表 config.colonies.js(B1地基/多home迭代) + reserver 加大[2C2M] + remoteHauler 優先撿散落energy
- D011: util.spawns.js 多 spawn 並行(消除 spawns[0] 瓶頸)
- D012: invader 防禦 — 巡邏 guard(travel.js跨房/動態re-target/多房輪巡) + reservation 第一道防線 + danger暫停改「確認制+有guard才取消等待」(無guard走pauseUntil 800→400)
- 新檔需一起部署: config.colonies.js, util.spawns.js
- 待辦: invader core 偵測(暫緩)、B2 main.js/remoteDefense 仍硬編碼 W49N25
