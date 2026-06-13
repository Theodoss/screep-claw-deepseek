# Screeps 永久決策記錄

> 每個高階決定記錄在此。時間、原因、結果、對應的 SKILL.md 規則。
> 這是巡迴之間唯一不會被 code pull 覆蓋的長期記憶。

---

## D001 — 禁止自動放置建築工地

- **時間**: 2026-06-12 ~ 2026-06-13
- **原因**: RCL 過渡期 `energyCapacityAvailable` 跳升但實際建築未完成，導致 body builder 用膨脹的成本計算 creep 身體，spawn 永遠付不起，殖民地連續崩潰兩次。
- **過程**:
  1. 06:32 加入 `placeControllerContainerSite`（自動放 controller container 工地）
  2. 15:00 自動巡迴加入 `placeExtensionSites`（自動放 extension 工地）
  3. 18:00 RCL3 升級後 capacity 從 550→800，body 成本膨脹，spawn 無法產兵 → 全滅
  4. 20:39 手動移除所有自動工地函數
  5. 00:00 自動巡迴看到函數消失，當作 bug 加回去
  6. 02:30 殖民地再次崩潰，再次手動移除
- **決策**: 永久禁止任何 `createConstructionSite` 自動化。工地只能玩家手動放。
- **對應 SKILL.md 規則**: `🛑 禁止自動放置任何建築工地`
- **教訓**: 巡迴之間沒有共享記憶，需要此 DECISIONS.md 作為跨巡迴的永久記錄。

---

## D002 — 移除 effectiveCapacity 自適應身體

- **時間**: 2026-06-12
- **原因**: `effectiveCapacity` 試圖在能量低谷自動縮小 creep body（`min(capacityMax, max(300, energyAvailable+100))`），但能量極低時 floor=300 仍然過高。spawn 只有 51 能量，`effectiveCapacity` 算出來是 401，小型 body 仍然 spawn 不出來。而且 RCL3 後未建成的 extension 讓 `energyCapacityAvailable` 虛高，問題疊加。
- **決策**: 直接使用 `room.energyCapacityAvailable`，不做自適應調整。生不出來就 fallthrough 到更便宜的 priority。
- **對應 SKILL.md 規則**: 分析與改善規則中的「檢查每個 creep 是否在正常工作」
- **教訓**: 自適應邏輯往往比固定常數更難 debug，特別是有 hidden state（未建成的 extension）的情況。

---

## D003 — Miner 不需要 CARRY 部件

- **時間**: 2026-06-12
- **原因**: Miner 站在 container 上採礦。無 CARRY 時 `harvest()` 的能量直接掉在地上，同格的 container 自動撿起。完全不需要經過 creep store → 不需要 CARRY。
- **結果**: RCL2 miner body 從 `[W×4,C,M]` (500) 優化為 `[W×5,M]` (550)，採礦效率 +25%。
- **對應 SKILL.md 規則**: 經濟優化規則
- **教訓**: Screeps game mechanics 細節影響很大，永遠先查 API 再設計 body。

---

## D004 — Spawn priority fallthrough

- **時間**: 2026-06-12
- **原因**: 當 spawn 能量不足時，高優先度的 spawn（miner 550 cost）失敗後直接 return，block 了低優先度的 spawn（hauler 450 → harvester 200）。導致恢復路徑被鎖死。
- **決策**: miner 和 hauler spawn 失敗時 fall through 到下一優先級，而非 block。
- **對應 SKILL.md 規則**: 存活優先（不可停擺）
- **教訓**: survival 優先級邏輯中，fallthrough 比 early return 更安全。

---

## D005 — 1000-tick 能量收入基準線

- **時間**: 2026-06-13
- **原因**: 每次巡迴只看瞬間狀態，無法偵測漸進式劣化。需要一個跨時間窗口的能量收入指標作為基準線。
- **實作**: `manager.stats.js` 每 20 ticks 記錄總房間能量（spawn+ext+container+creep store），存在 `Memory.agent.energySnapshots[]`，保留 1200 ticks。巡迴時取最早和最晚 snapshot 計算每 1000 ticks 能量產出，與上輪比較。
- **對應 SKILL.md 規則**: 巡迴流程第 2 步「檢查 1000-tick 能量收入」、劣化規則（降低 20% → 回滾檢討）
- **教訓**: 時間序列指標比瞬間快照更能捕捉系統性衰退。
