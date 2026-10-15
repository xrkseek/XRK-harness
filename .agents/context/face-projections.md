# Face 投影层（packages/server/face/src/projections）

投影 = 把 append-only 的 log 回放成客户端状态。两条硬规则，都是踩出来的。

## 1. `init` 必须每会话返回全新对象

绝不能返回模块级共享常量。`apply` 可能为了**让 change-feed 静默**而原地 mutate 字段
（turn-outline 的 `draft` 就是这么做的），共享单例会让上一轮的 draft 泄漏进新会话。

判据：apply 里出现 `state.x = y; return state` 就危险；`return { ...state, x: y }`
返新对象的是安全的。

## 2. 按 log 顺序推编号的字段，必须与 wire id map 对齐

像 `turnOutline.turn` 这种从 log 顺序推出来的编号，必须等于
`FaceWireIdMaps.turn()` 的结果 = **全日志「首次出现」序**。

只防「相邻重复」是不够的：历史重放时会在中间铸出幽灵回合。

## 3. 改 state 结构要同步抬 stateVersion

否则客户端会拿旧版本的 state 形状去解新数据。